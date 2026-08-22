import { requireReadyUser } from "../_shared/auth.ts";
import { decryptProviderKey, loadAIConfiguration, loadAIModel } from "../_shared/ai/configuration.ts";
import { callAIProvider } from "../_shared/ai/provider.ts";
import { AI_FEATURES, type AIFeature } from "../_shared/ai/schema.ts";
import { listRecentCommits } from "../_shared/github.ts";
import { ApiError, json, readJson, serve } from "../_shared/http.ts";
import { requireText, requireUuid } from "../_shared/validation.ts";

serve(async (request) => {
  const { user, admin } = await requireReadyUser(request);
  const body = await readJson<{ projectId?: unknown; modelSettingId?: unknown; feature?: unknown; messages?: unknown; context?: unknown }>(request, 262_144);
  const projectId = requireUuid(body.projectId, "Project ID");
  const modelSettingId = requireUuid(body.modelSettingId, "Model setting ID");
  const feature = requireText(body.feature, "AI 기능", 1, 40) as AIFeature;
  if (!AI_FEATURES.includes(feature)) throw new ApiError(400, "AI_FEATURE_INVALID", "지원하지 않는 AI 기능입니다.");
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 20) throw new ApiError(400, "AI_MESSAGES_INVALID", "최근 대화는 1~20개여야 합니다.");
  const messages = body.messages.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new ApiError(400, "AI_MESSAGES_INVALID", "대화 형식이 올바르지 않습니다.");
    const record = item as Record<string, unknown>;
    if (!["user", "assistant"].includes(String(record.role))) throw new ApiError(400, "AI_MESSAGES_INVALID", "대화 역할이 올바르지 않습니다.");
    return { role: record.role, content: requireText(record.content, "대화", 1, 6000) };
  });
  if (!body.context || typeof body.context !== "object" || Array.isArray(body.context)) throw new ApiError(400, "AI_CONTEXT_INVALID", "AI context가 올바르지 않습니다.");
  const { data: membership } = await admin.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle();
  if (!membership) throw new ApiError(403, "PROJECT_ACCESS_DENIED", "프로젝트 멤버만 Rocket AI를 사용할 수 있습니다.");
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await admin.from("ai_usage_logs").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
  if ((count ?? 0) >= 10) throw new ApiError(429, "AI_RATE_LIMIT", "잠시 후 다시 시도해 주세요.");
  const model = await loadAIModel(admin, modelSettingId);
  if (!model?.enabled) throw new ApiError(409, "AI_MODEL_UNAVAILABLE", "선택한 AI 모델을 사용할 수 없습니다.");
  const configuration = await loadAIConfiguration(admin, model.provider);
  if (!configuration?.api_key_ciphertext || !configuration.api_key_iv) throw new ApiError(409, "AI_NOT_CONFIGURED", "선택한 AI provider가 설정되지 않았습니다.");
  if (!configuration.enabled) throw new ApiError(409, "AI_DISABLED", "선택한 AI provider가 비활성화되어 있습니다.");
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 25_000);
  const started = Date.now(); let success = false; let inputTokens: number | null = null; let outputTokens: number | null = null;
  try {
    let githubActivity: Array<{ sha: string; message: string; authoredAt: string | null }> = [];
    if (feature === "github_summary") { const { data: project } = await admin.from("projects").select("github_repository_name, github_repository_url").eq("id", projectId).single(); if (project?.github_repository_url) githubActivity = await listRecentCommits(project.github_repository_name); }
    const prompt = JSON.stringify({ feature, messages, context: body.context, githubActivity, today: new Date().toISOString().slice(0, 10) });
    const response = await callAIProvider(model.provider, { apiKey: await decryptProviderKey(configuration.api_key_ciphertext, configuration.api_key_iv), model: model.model_id, system: "You are Rocket AI, a project-management assistant. Never claim that you changed data. Return proposals only until the user confirms. Use only supplied context and member UUIDs. Answer in Korean.", prompt, signal: controller.signal });
    success = true; inputTokens = response.inputTokens; outputTokens = response.outputTokens;
    return json(request, { ...response.result, model: { id: model.id, provider: model.provider, displayName: model.display_name } });
  } finally {
    clearTimeout(timeout);
    await admin.from("ai_usage_logs").insert({ user_id: user.id, project_id: projectId, feature, provider: model.provider, model: model.model_id, success, latency_ms: Date.now() - started, input_tokens: inputTokens, output_tokens: outputTokens });
  }
});
