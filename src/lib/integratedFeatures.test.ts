import { describe, expect, it } from "vitest";
import taskService from "../services/tasks.ts?raw";
import taskPage from "../pages/TaskPage.tsx?raw";
import projectPages from "../pages/ProjectPages.tsx?raw";
import secondaryPages from "../pages/ProjectSecondaryPages.tsx?raw";
import projectService from "../services/projects.ts?raw";
import fileService from "../services/files.ts?raw";
import aiService from "../services/ai.ts?raw";
import aiPanel from "../components/RocketAIPanel.tsx?raw";
import settingsPage from "../pages/GlobalPages.tsx?raw";
import appShell from "../components/AppShell.tsx?raw";
import migration from "../../supabase/migrations/202608220008_task_atomic_and_ai.sql?raw";
import deleteFunction from "../../supabase/functions/delete-github-repository/index.ts?raw";
import retryFunction from "../../supabase/functions/github-retry/index.ts?raw";
import aiFunction from "../../supabase/functions/ai-assistant/index.ts?raw";
import adminAIFunction from "../../supabase/functions/admin-ai-settings/index.ts?raw";
import gateway from "../../supabase/functions/_shared/ai/gateway.ts?raw";
import configuration from "../../supabase/functions/_shared/ai/configuration.ts?raw";
import { validateProjectFile } from "./filePolicy";

describe("integrated project security features", () => {
  it("creates tasks and deduplicated assignees in one authenticated transaction", () => {
    expect(taskService).toContain('supabase.rpc("create_task_atomic"');
    expect(taskService).toContain("p_description_encrypted: descriptionEncrypted");
    expect(migration).toContain("insert into public.tasks");
    expect(migration).toContain("insert into public.task_assignees");
    expect(migration).toContain("select distinct unnest");
    expect(migration).toContain("INVALID_ASSIGNEE");
    expect(taskService).not.toContain('supabase.from("tasks").delete()');
  });

  it("keeps task attachment bytes encrypted and cleans orphan uploads", () => {
    expect(fileService).toContain("encryptFile(file, key");
    expect(fileService).toContain('contentType: "application/octet-stream"');
    expect(fileService).toContain('from("project-files").remove([path])');
    expect(projectPages).toContain("uploadProjectFile(projectId, file, task.id");
    expect(taskPage).toContain("TaskAttachments");
    expect(taskPage).toContain("deleteProjectFile");
    expect(secondaryPages).toContain("연결된 작업:");
    expect(migration).toContain("grant delete on table public.files to authenticated");
  });

  it("rejects executable and oversized uploads", () => {
    expect(() => validateProjectFile({ name: "payload.exe", size: 10, type: "application/octet-stream" } as File)).toThrow(/실행/u);
    expect(() => validateProjectFile({ name: "large.pdf", size: 50 * 1024 * 1024 + 1, type: "application/pdf" } as File)).toThrow(/50 MiB/u);
  });

  it("makes GitHub management owner-only in UI, direct route and server", () => {
    expect(projectPages).not.toContain('path: "github"');
    expect(secondaryPages).toContain('role === "owner"');
    expect(secondaryPages).toContain("<GitHubIntegrationSection />");
    expect(retryFunction).toContain('action === "create_repository" ? actor.role !== "owner"');
    expect(deleteFunction).toContain('"PROJECT_OWNER_REQUIRED"');
  });

  it("deletes verified GitHub repo before storage and project rows, accepting a 404", () => {
    expect(deleteFunction.indexOf("getRepository")).toBeLessThan(deleteFunction.indexOf("deleteRepository(project.github_repository_name)"));
    expect(deleteFunction.indexOf("deleteRepository(project.github_repository_name)")).toBeLessThan(deleteFunction.indexOf('storage.from("project-files").remove'));
    expect(deleteFunction.indexOf('storage.from("project-files").remove')).toBeLessThan(deleteFunction.indexOf('from("projects").delete()'));
    expect(deleteFunction).toContain("isRepositoryForProject");
    expect(projectService).toContain("STORAGE_CLEANUP_FAILED");
  });

  it("keeps the AI Gateway credential server-only and encrypted at rest", () => {
    expect(migration).toContain("revoke all on table public.ai_provider_settings, public.ai_usage_logs from public, anon, authenticated");
    expect(configuration).toContain('Deno.env.get("AI_CONFIG_MASTER_KEY")');
    expect(configuration).toContain('"AES-GCM"');
    expect(adminAIFunction).toContain("requireSystemAdmin(request)");
    expect(adminAIFunction).not.toMatch(/return json\(request,\s*\{[^}]*apiKey/u);
    expect(aiService).not.toContain("localStorage");
    expect(aiService).not.toContain("sessionStorage");
  });

  it("authorizes project AI use, rate limits and returns proposals before mutation", () => {
    expect(aiFunction).toContain("requireReadyUser(request)");
    expect(aiFunction).toContain('from("project_members")');
    expect(aiFunction).toContain('from("ai_usage_logs")');
    expect(gateway).toContain("callAIGateway");
    expect(gateway).toContain('response_format: { type: "json_object" }');
    expect(aiPanel).toContain("제안은 확인 후에만 적용됩니다.");
    expect(aiPanel.indexOf("const ask =")).toBeLessThan(aiPanel.indexOf("const apply ="));
    expect(aiPanel).toContain("작업 생성");
  });

  it("removes technical crypto UI without changing key lock implementation", () => {
    expect(settingsPage).not.toContain("AES-256-GCM");
    expect(settingsPage).not.toContain("P-256 ECDH");
    expect(settingsPage).not.toContain("사용자 keyring");
    expect(appShell).toContain("KEYRING_INACTIVITY_TIMEOUT_MS");
    expect(appShell).toContain("touchSessionKeyring");
  });
});
