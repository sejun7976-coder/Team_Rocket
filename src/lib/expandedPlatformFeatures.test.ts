import { describe, expect, it } from "vitest";
import migration from "../../supabase/migrations/202608220009_ai_registry_user_deletion_task_rpc.sql?raw";
import triggerMigration from "../../supabase/migrations/202608220010_fix_domain_activity_triggers.sql?raw";
import aiAssistant from "../../supabase/functions/ai-assistant/index.ts?raw";
import aiModels from "../../supabase/functions/ai-models/index.ts?raw";
import adminAI from "../../supabase/functions/admin-ai-settings/index.ts?raw";
import aiConfiguration from "../../supabase/functions/_shared/ai/configuration.ts?raw";
import aiProvider from "../../supabase/functions/_shared/ai/provider.ts?raw";
import openai from "../../supabase/functions/_shared/ai/openai.ts?raw";
import anthropic from "../../supabase/functions/_shared/ai/anthropic.ts?raw";
import google from "../../supabase/functions/_shared/ai/google.ts?raw";
import githubStatus from "../../supabase/functions/github-repository-status/index.ts?raw";
import githubShared from "../../supabase/functions/_shared/github.ts?raw";
import adminDelete from "../../supabase/functions/admin-delete-user/index.ts?raw";
import aiPanel from "../components/RocketAIPanel.tsx?raw";
import appShell from "../components/AppShell.tsx?raw";
import adminPages from "../pages/AdminPages.tsx?raw";
import projectPages from "../pages/ProjectSecondaryPages.tsx?raw";
import taskService from "../services/tasks.ts?raw";

describe("multi-provider Rocket AI", () => {
  it.each([
    ["openai", openai, "api.openai.com/v1/responses"],
    ["anthropic", anthropic, "api.anthropic.com/v1/messages"],
    ["google", google, "generativelanguage.googleapis.com/v1beta/models"]
  ])("has an isolated %s adapter", (provider, source, endpoint) => {
    if (provider !== "openai") expect(aiProvider).toContain(`provider === "${provider}"`);
    else expect(aiProvider).toContain("callOpenAI(input)");
    expect(source).toContain(endpoint);
    expect(source).not.toContain("console.log");
  });

  it("migrates the OpenAI ciphertext and gives every provider a separate row/IV", () => {
    expect(migration).toContain("from public.ai_provider_settings_legacy");
    expect(migration).toContain("api_key_ciphertext, api_key_iv");
    expect(migration).toContain("values ('openai'), ('anthropic'), ('google')");
    expect(aiConfiguration).toContain("crypto.getRandomValues(new Uint8Array(12))");
    expect(aiConfiguration).toContain('Deno.env.get("AI_CONFIG_MASTER_KEY")');
  });

  it("keeps keys service-role-only and only returns configured state", () => {
    expect(migration).toContain("revoke all on table public.ai_provider_settings, public.ai_model_settings from public, anon, authenticated");
    expect(aiModels).not.toContain("api_key_ciphertext: item");
    expect(adminAI).toContain("configured: Boolean");
    expect(adminAI).not.toMatch(/apiKey:\s*item/u);
  });

  it("authorizes exclusively through an enabled modelSettingId", () => {
    expect(aiAssistant).toContain('requireUuid(body.modelSettingId, "Model setting ID")');
    expect(aiAssistant).toContain("if (!model?.enabled)");
    expect(aiAssistant).toContain("if (!configuration.enabled)");
    expect(aiAssistant).not.toContain("body.modelId");
    expect(aiAssistant).not.toContain("body.provider");
    expect(migration).toContain("unique(provider, model_id)");
  });

  it("records provider/model usage without prompt or response plaintext", () => {
    expect(aiAssistant).toContain('from("ai_usage_logs").insert');
    expect(aiAssistant).toContain("provider: model.provider");
    expect(aiAssistant).toContain("model: model.model_id");
    expect(aiAssistant).not.toMatch(/ai_usage_logs[\s\S]{0,300}(prompt|messages|response):/u);
  });
});

describe("floating multi-turn AI UI", () => {
  it("is a fixed bottom-right non-modal dock without backdrop", () => {
    expect(aiPanel).toContain("fixed bottom-4 right-4");
    expect(aiPanel).not.toContain("fixed inset-0");
    expect(aiPanel).not.toContain("aria-modal");
    expect(aiPanel).not.toContain("backdrop");
  });

  it("stays mounted at AppShell level and preserves messages while routes change", () => {
    expect(appShell).toContain("<RocketAIPanel />");
    expect(aiPanel).toContain("const [messages, setMessages]");
    expect(aiPanel).not.toContain('localStorage.setItem("rocket-ai:messages"');
    expect(aiPanel).toContain("useLocation()");
  });

  it("supports model grouping, switching, minimize, reopen and new conversation", () => {
    expect(aiPanel).toContain("<optgroup");
    expect(aiPanel).toContain('localStorage.setItem("rocket-ai:model"');
    expect(aiPanel).toContain("minimize");
    expect(aiPanel).toContain("setMessages([])");
  });

  it("limits multi-turn context and never mutates before proposal confirmation", () => {
    expect(aiPanel).toContain("slice(-20)");
    expect(aiAssistant).toContain("body.messages.length > 20");
    expect(aiPanel).toContain("window.confirm");
    expect(aiPanel.indexOf("window.confirm")).toBeLessThan(aiPanel.indexOf("await createTask"));
    expect(aiPanel).toContain('event.key === "Enter" && !event.shiftKey');
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
    expect(projectPages).toContain('project.status === "active" ? "활성"');
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
