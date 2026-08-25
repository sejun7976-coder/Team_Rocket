import { describe, expect, it } from "vitest";
import appShell from "../components/AppShell.tsx?raw";
import ui from "../components/ui.tsx?raw";
import adminPage from "../pages/AdminPages.tsx?raw";
import projectPages from "../pages/ProjectPages.tsx?raw";
import secondaryPages from "../pages/ProjectSecondaryPages.tsx?raw";
import activityService from "../services/activity.ts?raw";
import projectService from "../services/projects.ts?raw";
import adminService from "../services/admin.ts?raw";
import roleFunction from "../../supabase/functions/admin-set-user-role/index.ts?raw";
import migration from "../../supabase/migrations/202608240001_project_announcements_and_admin_roles.sql?raw";
import permissionMigration from "../../supabase/migrations/202608240002_admin_permissions.sql?raw";
import generalPermissionMigration from "../../supabase/migrations/202608250002_general_permissions_and_ai_models.sql?raw";
import announcementConstraintFix from "../../supabase/migrations/20260825043731_fix_project_announcement_activity_constraints.sql?raw";
import dueNotificationGuardFix from "../../supabase/migrations/20260825044047_fix_due_notification_account_guard.sql?raw";

describe("project workspace enhancements", () => {
  it("keeps project activity explicitly scoped while RLS remains membership-based", () => {
    expect(activityService).toContain("listProjectActivities(projectId: string)");
    expect(activityService).toContain('.eq("project_id", projectId)');
    expect(projectPages).toContain("listProjectActivities(project.id)");
    expect(secondaryPages).toContain("listProjectActivities(project.id)");
    expect(migration).toContain("public.is_project_member(project_id)");
  });

  it("encrypts one shared announcement per project and records its activity", () => {
    expect(projectService).toContain('entityType: "project-announcement"');
    expect(projectService).toContain("encryptContent(normalized");
    expect(projectService).toContain("decryptContent<string>");
    expect(migration).toContain("project_id uuid primary key");
    expect(migration).toContain("content_encrypted jsonb not null");
    expect(migration).toContain("record_project_announcement_activity");
    expect(projectPages).toContain("프로젝트 멤버 모두가 함께 편집할 수 있습니다.");
  });

  it("keeps announcement activity types and due-notification access guards aligned with the current schema", () => {
    for (const subjectType of [
      "project",
      "member",
      "task",
      "assignee",
      "comment",
      "file",
      "project_announcement",
    ]) {
      expect(announcementConstraintFix).toContain(`'${subjectType}'`);
    }
    expect(announcementConstraintFix).toContain("validate constraint activities_subject_type_check");
    expect(migration).toContain("'announcement_created'");
    expect(migration).toContain("'announcement_updated'");
    expect(dueNotificationGuardFix).toContain("if not public.can_access_business_data() then");
    expect(dueNotificationGuardFix).not.toContain("current_account_ready");
    expect(dueNotificationGuardFix).toMatch(/grant execute on function public\.refresh_due_notifications\(\)\s+to authenticated;/u);
    expect(dueNotificationGuardFix).toMatch(/grant execute on function public\.refresh_due_notifications\(\)\s+to service_role;/u);
  });

  it("changes existing system roles only through a capability-protected server path", () => {
    expect(adminService).toContain('invokeAdmin("admin-set-user-role"');
    expect(roleFunction).toContain("await requireReadyUser(request)");
    expect(roleFunction).toContain("requirePermission(context");
    expect(roleFunction).not.toContain("requireSystemAdmin(request)");
    expect(roleFunction).toContain("ADMIN_PERMISSIONS.USERS_CHANGE_ROLE");
    expect(roleFunction).toContain('rpc("set_managed_system_role"');
    expect(roleFunction).toContain("admin.auth.admin.updateUserById");
    expect(roleFunction).toContain('rpc("restore_system_role_and_permissions_after_auth_failure"');
    expect(permissionMigration).toContain("LAST_SYSTEM_ADMIN");
    expect(generalPermissionMigration).toContain("LAST_SYSTEM_ADMIN");
    expect(generalPermissionMigration).toContain("LAST_PERMISSION_MANAGER");
    expect(adminPage).toContain("계정의 기본 분류입니다. 실제로 사용할 수 있는 기능은 기능 권한 설정에서 결정됩니다.");
  });

  it("uses a shared dismissible popover across notifications and action menus", () => {
    expect(ui).toContain('document.addEventListener("pointerdown"');
    expect(ui).toContain('event.key !== "Escape"');
    expect(ui).toContain("POPOVER_OPEN_EVENT");
    expect(appShell).toContain('dismissKey={location.pathname}');
    expect(adminPage).toContain('role="menu"');
  });

  it("links the brand to Dashboard and shows the project member avatar stack", () => {
    expect(appShell).toContain('<Link\n                to="/dashboard"');
    expect(projectPages).toContain("전체 참여 팀원 보기");
    expect(projectPages).toContain("members.data?.slice(0, 5)");
    expect(projectPages).toContain("projectRoleLabels[member.role]");
  });
});
