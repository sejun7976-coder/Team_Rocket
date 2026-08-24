import { describe, expect, it } from "vitest";
import { PERMISSION_KEYS, PERMISSIONS, isPermission } from "../../supabase/functions/_shared/adminPermissions";
import authSource from "../../supabase/functions/_shared/auth.ts?raw";
import adminCreateUser from "../../supabase/functions/admin-create-user/index.ts?raw";
import adminDeleteUser from "../../supabase/functions/admin-delete-user/index.ts?raw";
import adminListAccessLogs from "../../supabase/functions/admin-list-access-logs/index.ts?raw";
import adminListProjects from "../../supabase/functions/admin-list-projects/index.ts?raw";
import adminListUsers from "../../supabase/functions/admin-list-users/index.ts?raw";
import adminResetPassword from "../../supabase/functions/admin-reset-password/index.ts?raw";
import adminSetPermissions from "../../supabase/functions/admin-set-user-permissions/index.ts?raw";
import adminSetRole from "../../supabase/functions/admin-set-user-role/index.ts?raw";
import adminSetStatus from "../../supabase/functions/admin-set-user-status/index.ts?raw";
import createProject from "../../supabase/functions/create-project/index.ts?raw";
import deleteProject from "../../supabase/functions/delete-github-repository/index.ts?raw";
import roleMigration from "../../supabase/migrations/202608220002_admin_account_policy.sql?raw";
import originalPermissionMigration from "../../supabase/migrations/202608240002_admin_permissions.sql?raw";
import enumMigration from "../../supabase/migrations/202608250001_add_ai_permissions.sql?raw";
import generalMigration from "../../supabase/migrations/202608250002_general_permissions_and_ai_models.sql?raw";
import aiLogsEnumMigration from "../../supabase/migrations/202608250003_add_ai_logs_permission.sql?raw";
import adminPageSource from "../pages/AdminPages.tsx?raw";
import dashboardSource from "../pages/DashboardPage.tsx?raw";

const guardedFunctions = [
  [adminCreateUser, "ADMIN_PERMISSIONS.USERS_CREATE"],
  [adminDeleteUser, "ADMIN_PERMISSIONS.USERS_DELETE"],
  [adminListAccessLogs, "ADMIN_PERMISSIONS.ACCESS_LOGS_VIEW"],
  [adminListProjects, "ADMIN_PERMISSIONS.PROJECTS_VIEW"],
  [adminListUsers, "ADMIN_PERMISSIONS.USERS_VIEW"],
  [adminResetPassword, "ADMIN_PERMISSIONS.USERS_RESET_PASSWORD"],
  [adminSetPermissions, "ADMIN_PERMISSIONS.USERS_MANAGE_PERMISSIONS"],
  [adminSetRole, "ADMIN_PERMISSIONS.USERS_CHANGE_ROLE"],
  [adminSetStatus, "ADMIN_PERMISSIONS.USERS_CHANGE_STATUS"],
  [createProject, "ADMIN_PERMISSIONS.PROJECTS_CREATE"],
  [deleteProject, "ADMIN_PERMISSIONS.PROJECTS_DELETE"],
] as const;

describe("role-independent permission authorization", () => {
  it("keeps exactly User and Admin as system roles", () => {
    const declaration = roleMigration.match(/create type public\.system_role as enum \([^;]+\);/u)?.[0];
    expect(declaration).toBe("create type public.system_role as enum ('user', 'admin');");
  });

  it("uses one 14-key registry including AI capabilities", () => {
    expect(PERMISSION_KEYS).toEqual([
      "projects.view", "projects.create", "projects.delete",
      "users.view", "users.create", "users.delete", "users.change_status",
      "users.reset_password", "users.change_role", "users.manage_permissions",
      "access_logs.view", "ai.use", "ai.manage", "ai.logs.view",
    ]);
    expect(PERMISSION_KEYS.every(isPermission)).toBe(true);
    expect(isPermission("users.superuser")).toBe(false);
    expect(enumMigration).toContain("'ai.use'");
    expect(enumMigration).toContain("'ai.manage'");
    expect(aiLogsEnumMigration).toContain("'ai.logs.view'");
  });

  it("requires readiness and the mapped permission without a role bypass", () => {
    for (const [source, permission] of guardedFunctions) {
      expect(source).toMatch(/requirePermission\(\s*context,/u);
      expect(source).toContain("await requireReadyUser(request)");
      expect(source).toContain(permission);
      expect(source).not.toContain("await requireSystemAdmin(request)");
    }
    expect(authSource).toContain("export async function requirePermission");
    expect(authSource).toContain('eq("permission", permission)');
    const generalGuard = authSource.match(/export async function requirePermission[\s\S]*?return context;\n\}/u)?.[0] ?? "";
    expect(generalGuard).not.toContain("canActAsSystemAdmin");
    expect(generalGuard).not.toContain("system_role");
  });

  it("keeps one RLS-protected table while allowing User permissions", () => {
    expect(originalPermissionMigration).toContain("create table public.user_admin_permissions");
    expect(generalMigration).toContain("drop trigger if exists user_admin_permissions_admin_only");
    expect(generalMigration).toContain("drop trigger if exists profiles_remove_permissions_when_demoted");
    expect(generalMigration).toContain("create policy user_admin_permissions_select_self");
    expect(generalMigration).not.toContain("TARGET_ADMIN_REQUIRED");
    expect(generalMigration).toContain("create or replace function public.set_user_permissions");
    expect(generalMigration).toContain("permission.permission = 'users.manage_permissions'");
    expect(generalMigration).not.toMatch(/actor\.system_role\s*=\s*'admin'/u);
  });

  it("protects the last system Admin and the last active permission manager independently", () => {
    expect(generalMigration).toContain("LAST_SYSTEM_ADMIN");
    expect(generalMigration).toContain("LAST_PERMISSION_MANAGER");
    expect(generalMigration).toContain("protect_last_permission_manager_on_profile_delete");
    expect(generalMigration).toContain("pg_advisory_xact_lock(724202608240002)");
    expect(generalMigration).toContain(PERMISSIONS.USERS_MANAGE_PERMISSIONS);
  });

  it("lets User and Admin rows use the same permission dialog and cache", () => {
    expect(adminPageSource).toContain('<option value="user">User</option>');
    expect(adminPageSource).toContain('<option value="admin">Admin</option>');
    expect(adminPageSource).toContain("계정의 기본 분류입니다. 실제로 사용할 수 있는 기능은 기능 권한 설정에서 결정됩니다.");
    expect(adminPageSource).toContain("프로젝트 생성·삭제, 사용자 관리 등 이 계정이 실제로 사용할 수 있는 기능을 설정합니다.");
    expect(adminPageSource).not.toContain('managedUser.system_role !== "admin"');
    expect(adminPageSource).toContain("PERMISSION_REGISTRY");
    expect(dashboardSource).toContain("usePermissions");
    expect(dashboardSource).toContain("ADMIN_PERMISSIONS.PROJECTS_CREATE");
  });
});
