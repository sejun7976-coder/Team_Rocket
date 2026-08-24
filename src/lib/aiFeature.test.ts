import { describe, expect, it } from "vitest";
import { AI_MODEL_CATALOG, findAIModel } from "../../supabase/functions/_shared/ai/modelCatalog";
import aiChat from "../../supabase/functions/ai-chat/index.ts?raw";
import aiModels from "../../supabase/functions/ai-models/index.ts?raw";
import aiSettings from "../../supabase/functions/admin-ai-settings/index.ts?raw";
import gateway from "../../supabase/functions/_shared/ai/gateway.ts?raw";
import config from "../../supabase/config.toml?raw";
import panel from "../components/RocketAIPanel.tsx?raw";
import actionExecutor from "./aiActions.ts?raw";
import taskService from "../services/tasks.ts?raw";
import taskMigration from "../../supabase/migrations/202608220010_fix_domain_activity_triggers.sql?raw";

const expectedIds = [
  "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.5",
  "claude-sonnet-5", "claude-opus-5", "claude-fable-5", "claude-opus-4-8", "claude-haiku-4-5-20251001",
  "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-pro-preview",
  "grok-4.6", "grok-4.5", "grok-4-1-fast", "google/gemma-4-31B-it",
  "sonar-pro", "sonar-reasoning-pro", "solar-pro4", "LGAI-EXAONE/K-EXAONE-2.0-750B-A37B",
  "qwen3.8-max", "qwen3.7-plus", "qwen3.7-max", "glm-5.2", "kimi-k3", "kimi-k2.6",
  "seed-2-0-pro-260328", "seed-2-0-lite-260428", "deepseek-v4-pro", "deepseek-v4-flash",
];

describe("Rocket AI security and catalog", () => {
  it("uses the exact central 32-model catalog", () => {
    expect(AI_MODEL_CATALOG.map((model) => model.id)).toEqual(expectedIds);
    expect(new Set(AI_MODEL_CATALOG.map((model) => model.displayName))).toHaveLength(32);
    expect(findAIModel("gpt-5.6-sol")?.displayName).toBe("GPT-5.6 Sol");
    expect(findAIModel("unknown/model")).toBeNull();
  });

  it("guards chat/model reads with ai.use and settings with ai.manage regardless of role", () => {
    for (const source of [aiChat, aiModels]) {
      expect(source).toContain("await requireReadyUser(request)");
      expect(source).toContain("ADMIN_PERMISSIONS.AI_USE");
      expect(source).toContain("requirePermission(context");
      expect(source).not.toContain("requireSystemAdmin");
    }
    expect(aiSettings).toContain("ADMIN_PERMISSIONS.AI_MANAGE");
    expect(aiSettings).toContain("requirePermission(context");
    expect(aiSettings).not.toContain("requireSystemAdmin");
  });

  it("rejects unknown or disabled model IDs on the server and returns only enabled models", () => {
    expect(aiChat).toContain("AI_MODEL_UNKNOWN");
    expect(aiChat).toContain("AI_MODEL_UNAVAILABLE");
    expect(aiChat).toContain("!modelResult.data?.enabled");
    expect(aiModels).toContain('.eq("enabled", true)');
    expect(aiSettings).toContain("if (!findAIModel(modelId))");
  });

  it("keeps the single Gateway credential in Edge secrets and never exposes or persists it", () => {
    for (const source of [aiChat, aiSettings]) {
      expect(source).toContain('Deno.env.get("AI_GATEWAY_BASE_URL")');
      expect(source).toContain('Deno.env.get("AI_GATEWAY_API_KEY")');
      expect(source).not.toContain("ai_gateway_settings");
    }
    expect(gateway).toContain("Authorization: `Bearer ${input.apiKey}`");
    expect(panel).not.toContain("AI_GATEWAY_API_KEY");
    expect(config).toContain("[functions.ai-chat]\nverify_jwt = false");
    expect(config).toContain("[functions.ai-models]\nverify_jwt = false");
    expect(config).toContain("[functions.admin-ai-settings]\nverify_jwt = false");
  });

  it("executes approved mutations through existing client services and the existing Activity path", () => {
    expect(actionExecutor).toContain("services.createTask");
    expect(actionExecutor).toContain("services.updateTask");
    expect(actionExecutor).toContain("services.addAssignee");
    expect(actionExecutor).not.toContain("service_role");
    expect(taskService).toContain('rpc("create_task_atomic"');
    expect(taskMigration).toContain("execute function public.record_task_activity()");
    expect(panel).toContain("실행 전 확인");
    expect(panel).toContain('actionState: "cancelled"');
  });
});
