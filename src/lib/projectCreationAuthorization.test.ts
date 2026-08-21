import { describe, expect, it } from "vitest";
import { canActAsSystemAdmin } from "../../supabase/functions/_shared/accountPolicy";
import createProjectSource from "../../supabase/functions/create-project/index.ts?raw";
import migrationSql from "../../supabase/migrations/202608220007_admin_project_access_logs.sql?raw";
import dashboardSource from "../pages/DashboardPage.tsx?raw";
import dialogSource from "../components/NewProjectDialog.tsx?raw";

describe("system-admin-only project creation", () => {
  it("denies a ready normal user and accepts an active completed system admin", () => {
    expect(canActAsSystemAdmin("user", "active", { must_change_password: false, system_role: "user" })).toBe(false);
    expect(canActAsSystemAdmin("admin", "active", { must_change_password: false, system_role: "admin" })).toBe(true);
    expect(canActAsSystemAdmin("admin", "password_change_required", { must_change_password: false, system_role: "admin" })).toBe(false);
  });

  it("uses the server guard that returns SYSTEM_ADMIN_REQUIRED for direct calls", () => {
    expect(createProjectSource).toContain('requireSystemAdmin(request)');
    expect(createProjectSource).not.toContain('requireReadyUser(request)');
    expect(createProjectSource).toContain('"SYSTEM_ADMIN_REQUIRED"');
  });

  it("verifies the trusted creator in the service-role RPC", () => {
    expect(migrationSql).toContain("auth.role() <> 'service_role'");
    expect(migrationSql).toContain("system_role = 'admin'");
    expect(migrationSql).toContain("account_status = 'active'");
    expect(migrationSql).toContain("errcode = 'PPC01'");
    expect(migrationSql).toContain("from public, anon, authenticated");
  });

  it("does not render or execute project creation UI for a normal user", () => {
    expect(dashboardSource).toContain("const admin = isSystemAdmin(user, profile)");
    expect(dashboardSource).toContain("action={admin ?");
    expect(dashboardSource).toContain("{admin && <NewProjectDialog");
    expect(dialogSource).toContain("if (!admin || !open) return null");
    expect(dialogSource).toContain("if (!admin) throw new Error");
  });
});
