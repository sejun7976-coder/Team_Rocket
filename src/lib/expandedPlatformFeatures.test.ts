import { describe, expect, it } from "vitest";
import migration from "../../supabase/migrations/202608220009_ai_registry_user_deletion_task_rpc.sql?raw";
import triggerMigration from "../../supabase/migrations/202608220010_fix_domain_activity_triggers.sql?raw";
import taskDeleteMigration from "../../supabase/migrations/202608220011_fix_task_deletion.sql?raw";
import githubStatus from "../../supabase/functions/github-repository-status/index.ts?raw";
import githubShared from "../../supabase/functions/_shared/github.ts?raw";
import adminDelete from "../../supabase/functions/admin-delete-user/index.ts?raw";
import adminPages from "../pages/AdminPages.tsx?raw";
import projectPages from "../pages/ProjectSecondaryPages.tsx?raw";
import taskService from "../services/tasks.ts?raw";
import taskPage from "../pages/TaskPage.tsx?raw";
import taskDelete from "../../supabase/functions/delete-task/index.ts?raw";
import markdownText from "../components/MarkdownText.tsx?raw";

describe("recoverable Task deletion", () => {
  it("fixes the assignee cascade trigger without manufacturing delete activity", () => {
    expect(taskDeleteMigration).toContain("if v_project_id is null then");
    expect(taskDeleteMigration).toContain("return old");
    expect(taskDeleteMigration).toContain("create or replace function public.record_assignee_activity()");
  });

  it("authorizes owner/admin/creator on the server and never grants deletion to an assignee", () => {
    expect(taskDelete).toContain('["owner", "admin"].includes(member.role)');
    expect(taskDelete).toContain("task.created_by === user.id");
    expect(taskDelete).not.toContain('from("task_assignees")');
    expect(taskDelete).toContain("TASK_DELETE_FORBIDDEN");
  });

  it("removes trusted DB file paths before the Task and treats missing objects idempotently", () => {
    expect(taskDelete).toContain('from("files").select("storage_path")');
    expect(taskDelete.indexOf('.storage.from("project-files").remove')).toBeLessThan(taskDelete.indexOf('from("tasks").delete()'));
    expect(taskDelete).toContain("isStorageNotFound(error)");
    expect(taskDelete).toContain("TASK_STORAGE_CLEANUP_FAILED");
    expect(taskDelete).toContain("작업은 보존되었습니다");
  });

  it("uses only the authenticated Edge path and maps stable deletion errors", () => {
    expect(taskService).toContain('invokeAuthenticatedFunction("delete-task"');
    expect(taskService).not.toContain('supabase.from("tasks").delete()');
    for (const code of ["TASK_NOT_FOUND", "TASK_DELETE_FORBIDDEN", "TASK_STORAGE_CLEANUP_FAILED", "TASK_DELETE_CONFLICT", "TASK_DELETE_DB_FAILED", "TASK_SCHEMA_ERROR"]) expect(taskService).toContain(code);
  });
});

describe("Task description detail UX", () => {
  it("switches between one Markdown reader and one editor while preserving revision concurrency", () => {
    expect(taskPage).toContain("editingDescription ?");
    expect(taskPage).toContain("<MarkdownText>{task.description}</MarkdownText>");
    expect(taskPage).toContain("setEditingDescription(false)");
    expect(taskPage).not.toContain("revision {task.revision}");
    expect(taskService).toContain("revision: task.revision + 1");
    expect(taskService).toContain('.eq("revision", task.revision)');
  });

  it("renders Markdown as escaped React text nodes without raw HTML injection", () => {
    expect(markdownText).not.toContain("dangerouslySetInnerHTML");
    expect(markdownText).toContain("<span");
    expect(taskPage).toContain("설명이 없습니다.");
  });
});

describe("GitHub reconciliation", () => {
  it("distinguishes connected, recoverable, missing and conflict using GitHub truth", () => {
    for (const state of ["connected", "recoverable", "missing", "conflict"]) expect(githubStatus).toContain(`"${state}"`);
    expect(githubStatus).toContain("getRepository");
    expect(githubStatus).toContain("repositoryMarkerStatus");
    expect(githubStatus).toContain("upgradeRepositoryMarker");
    expect(githubStatus).toContain("trustedMetadata");
    expect(githubStatus).toContain('rpc("finalize_project_creation"');
    expect(githubStatus).toContain('status: "not_connected"');
    expect(githubStatus).toContain('error_code: "GITHUB_REPOSITORY_MISSING"');
  });

  it("upgrades only the same project's legacy marker and preserves idempotency", () => {
    expect(githubShared).toContain('marker === "legacy"');
    expect(githubShared).toContain("upgradeRepositoryMarker(existing.name, input.projectId)");
    expect(githubShared).toContain('marker !== "canonical"');
    expect(githubShared).toContain("REPOSITORY_NAME_CONFLICT");
  });

  it("is owner-only and refreshes status/project/header after retry", () => {
    expect(githubStatus).toContain('member?.role !== "owner"');
    expect(projectPages).toContain('queryKey: ["github-repository-status"');
    expect(projectPages).toContain('queryKey: ["project", project.id]');
    expect(projectPages).toContain('queryKey: ["projects"]');
    expect(projectPages).toContain('role === "owner"');
    expect(projectPages).toContain("<GitHubIntegrationSection />");
    expect(projectPages).toContain('state === "connected"');
    expect(projectPages).toContain('"미연결"');
    expect(projectPages).toContain('repositoryStatus.data?.status !== "recoverable"');
    expect(projectPages).toContain("refetchRepositoryStatus()");
  });
});

describe("admin account deletion", () => {
  it("uses a compact responsive row with a secondary action menu", () => {
    expect(adminPages).not.toContain('min-w-[1500px]');
    expect(adminPages).toContain("<details");
    expect(adminPages).toContain("완전 삭제");
    expect(adminPages).toContain("grid-cols-[minmax(0,1fr)_auto]");
  });

  it("rejects self, system admins and project owners", () => {
    expect(adminDelete).toContain("CANNOT_DELETE_SELF");
    expect(adminDelete).toContain("SYSTEM_ADMIN_PROTECTED");
    expect(adminDelete).toContain("USER_OWNS_PROJECTS");
    expect(adminDelete).toContain("requireSystemAdmin(request)");
  });

  it("removes collaborators before Auth and preserves audit snapshots", () => {
    expect(adminDelete.indexOf("removeCollaborator")).toBeLessThan(adminDelete.indexOf("admin.auth.admin.deleteUser"));
    expect(adminDelete).toContain("GITHUB_COLLABORATOR_CLEANUP_FAILED");
    expect(migration).toContain("student_id_snapshot");
    expect(migration).toContain("on delete set null");
    expect(adminDelete).toContain("student_id_snapshot");
  });
});

describe("atomic task creation diagnostics", () => {
  it("matches the RPC signature and supports null dates and deduplicated assignees", () => {
    for (const argument of ["p_task_id", "p_project_id", "p_title", "p_description_encrypted", "p_status", "p_priority", "p_progress", "p_start_date", "p_due_date", "p_assignee_ids"]) {
      expect(taskService).toContain(`${argument}:`);
      expect(migration).toContain(argument);
    }
    expect(taskService).toContain("input.dueDate?.trim() || null");
    expect(taskService).toContain("new Set(input.assigneeIds ?? [])");
    expect(migration).toContain("array[]::uuid[]");
    expect(migration).toContain("select distinct unnest");
  });

  it("keeps ciphertext atomic and publishes an authenticated-only RPC", () => {
    expect(taskService).toContain("p_description_encrypted: descriptionEncrypted");
    expect(migration).toContain("grant execute on function public.create_task_atomic");
    expect(migration).toContain("to authenticated, service_role");
    expect(migration).toContain("from public, anon");
    expect(migration).toContain("notify pgrst, 'reload schema'");
  });

  it("maps actionable PostgREST/Postgres codes instead of hiding every failure", () => {
    for (const code of ["PGRST202", "42883", "42501", "42703", "23503", "22007", "22P02"]) expect(taskService).toContain(code);
    expect(taskService).toContain("TASK_RPC_NOT_AVAILABLE");
    expect(taskService).toContain("TASK_SCHEMA_ERROR");
    expect(taskService).toContain("TASK_PERMISSION_DENIED");
    expect(taskService).toContain("INVALID_ASSIGNEE");
    expect(taskService).not.toContain("descriptionEncrypted, error");
  });

  it("replaces the polymorphic trigger with row-specific functions", () => {
    expect(triggerMigration).toContain("drop function if exists public.record_domain_activity()");
    expect(triggerMigration).toContain("execute function public.record_task_activity()");
    expect(triggerMigration).toContain("execute function public.record_assignee_activity()");
    expect(triggerMigration).toContain("execute function public.record_comment_activity()");
    expect(triggerMigration).toContain("execute function public.record_file_activity()");
    expect(triggerMigration).toContain("v_actor_id := new.created_by");
    expect(triggerMigration).toContain("values (new.user_id, v_project_id, new.task_id, 'task_assigned'");
  });

  it("never reads an assignee-only user_id field inside the task trigger", () => {
    const taskFunction = triggerMigration.match(/create or replace function public\.record_task_activity\(\)[\s\S]*?\$\$;/u)?.[0] ?? "";
    expect(taskFunction).toContain("new.created_by");
    expect(taskFunction).not.toMatch(/(?:new|old)\.user_id/u);
    expect(taskFunction).toContain("insert into public.activities");
    expect(taskFunction).toContain("insert into public.notifications");
  });
});
