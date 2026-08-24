import { describe, expect, it } from "vitest";
import createProjectSource from "../../supabase/functions/create-project/index.ts?raw";
import migrationSql from "../../supabase/migrations/202608250002_general_permissions_and_ai_models.sql?raw";
import dashboardSource from "../pages/DashboardPage.tsx?raw";
import dialogSource from "../components/NewProjectDialog.tsx?raw";

describe("permission-based project creation", () => {
  it("uses account readiness plus projects.create without a role gate", () => {
    expect(createProjectSource).toContain("await requireReadyUser(request)");
    expect(createProjectSource).toContain("ADMIN_PERMISSIONS.PROJECTS_CREATE");
    expect(createProjectSource).toContain("requirePermission(context");
    expect(createProjectSource).not.toContain("requireSystemAdmin(request)");
    expect(createProjectSource).not.toContain("SYSTEM_ADMIN_REQUIRED");
  });

  it("verifies projects.create again in the service-role RPC", () => {
    const beginFunction = migrationSql.match(/create or replace function public\.begin_project_creation[\s\S]*?\$\$;/u)?.[0] ?? "";
    expect(beginFunction).toContain("auth.role() <> 'service_role'");
    expect(beginFunction).toContain("permission.permission = 'projects.create'");
    expect(beginFunction).toContain("actor.account_status = 'active'");
    expect(beginFunction).not.toContain("actor.system_role");
    expect(beginFunction).toContain("PERMISSION_REQUIRED");
  });

  it("shows creation UI to any User/Admin account with the capability", () => {
    expect(dashboardSource).toContain("usePermissions");
    expect(dashboardSource).toContain("canCreateProject");
    expect(dashboardSource).toContain("ADMIN_PERMISSIONS.PROJECTS_CREATE");
    expect(dialogSource).toContain("if (!canCreate || !open) return null");
    expect(dialogSource).not.toContain("if (!admin");
  });
});
