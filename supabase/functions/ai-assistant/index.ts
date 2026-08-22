import { requireReadyUser } from "../_shared/auth.ts";
import { decryptProviderKey, loadAIConfiguration } from "../_shared/ai/configuration.ts";
import { callOpenAI } from "../_shared/ai/provider.ts";
import { AI_FEATURES, type AIFeature } from "../_shared/ai/schema.ts";
import { ApiError, json, readJson, serve } from "../_shared/http.ts";
import { requireText, requireUuid } from "../_shared/validation.ts";
import { listRecentCommits } from "../_shared/github.ts";

serve(async (request) => {
  const { user, admin } = await requireReadyUser(request);
  const body = await readJson<{ projectId?: unknown; feature?: unknown; prompt?: unknown; context?: unknown }>(request, 262_144);
  const projectId = requireUuid(body.projectId, "Project ID");
  const feature = requireText(body.feature, "AI 기능", 1, 40) as AIFeature;
  if (!AI_FEATURES.includes(feature)) throw new ApiError(400, "AI_FEATURE_INVALID", "지원하지 않는 AI 기능입니다.");
  const prompt = requireText(body.prompt, "요청", 1, 4000);
  if (!body.context || typeof body.context !== "object" || Array.isArray(body.context)) throw new ApiError(400, "AI_CONTEXT_INVALID", "AI context가 올바르지 않습니다.");
  const { data: membership } = await admin.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle();
  if (!membership) throw new ApiError(403, "PROJECT_ACCESS_DENIED", "프로젝트 멤버만 Rocket AI를 사용할 수 있습니다.");

  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await admin.from("ai_usage_logs").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
  if ((count ?? 0) >= 10) throw new ApiError(429, "AI_RATE_LIMIT", "잠시 후 다시 시도해 주세요.");
  const configuration = await loadAIConfiguration(admin);
  if (!configuration?.api_key_ciphertext || !configuration.api_key_iv) throw new ApiError(409, "AI_NOT_CONFIGURED", "Rocket AI가 아직 설정되지 않았습니다.");
  if (!configuration.enabled) throw new ApiError(409, "AI_DISABLED", "Rocket AI가 비활성화되어 있습니다.");

  const apiKey = await decryptProviderKey(configuration.api_key_ciphertext, configuration.api_key_iv);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  const started = Date.now();
  let success = false;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  try {
    let githubActivity: Array<{ sha: string; message: string; authoredAt: string | null }> = [];
    if (feature === "github_summary") {
      const { data: project } = await admin.from("projects").select("github_repository_name, github_repository_url").eq("id", projectId).single();
      if (project?.github_repository_url) githubActivity = await listRecentCommits(project.github_repository_name);
    }
    const providerPrompt = JSON.stringify({ feature, userRequest: prompt, context: body.context, githubActivity, today: new Date().toISOString().slice(0, 10) });
    const response = await callOpenAI({ apiKey, model: configuration.model, prompt: providerPrompt, signal: controller.signal });
    success = true; inputTokens = response.inputTokens; outputTokens = response.outputTokens;
    return json(request, response.result);
  } finally {
    clearTimeout(timeout);
    await admin.from("ai_usage_logs").insert({ user_id: user.id, project_id: projectId, feature, provider: configuration.provider, model: configuration.model, success, latency_ms: Date.now() - started, input_tokens: inputTokens, output_tokens: outputTokens });
  }
});
