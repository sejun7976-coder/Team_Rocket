import { requireSystemAdmin } from "../_shared/auth.ts";
import { decryptProviderKey, encryptProviderKey, loadAIConfiguration } from "../_shared/ai/configuration.ts";
import { callOpenAI } from "../_shared/ai/provider.ts";
import { ApiError, json, readJson, serve } from "../_shared/http.ts";
import { requireText } from "../_shared/validation.ts";

function status(configuration: Awaited<ReturnType<typeof loadAIConfiguration>>) {
  return { enabled: configuration?.enabled ?? false, provider: "openai" as const, model: configuration?.model ?? "gpt-4.1-mini", configured: Boolean(configuration?.api_key_ciphertext && configuration.api_key_iv), updatedAt: configuration?.updated_at ?? null };
}

serve(async (request) => {
  const { user, admin } = await requireSystemAdmin(request);
  const body = await readJson<{ action?: unknown; enabled?: unknown; provider?: unknown; model?: unknown; apiKey?: unknown }>(request);
  const action = requireText(body.action, "작업", 1, 30);
  const current = await loadAIConfiguration(admin);
  if (action === "get") return json(request, status(current));
  if (action === "delete_key") {
    const { error } = await admin.from("ai_provider_settings").upsert({ id: true, enabled: false, provider: "openai", model: current?.model ?? "gpt-4.1-mini", api_key_ciphertext: null, api_key_iv: null, updated_by: user.id, updated_at: new Date().toISOString() });
    if (error) throw new ApiError(500, "AI_CONFIGURATION_FAILED", "AI 설정을 저장할 수 없습니다.");
    return json(request, status(await loadAIConfiguration(admin)));
  }
  if (action === "save") {
    if (body.provider !== "openai") throw new ApiError(400, "AI_PROVIDER_INVALID", "지원하지 않는 AI provider입니다.");
    const model = requireText(body.model, "Model", 1, 100);
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    const encrypted = apiKey ? await encryptProviderKey(apiKey) : null;
    const ciphertext = encrypted?.ciphertext ?? current?.api_key_ciphertext ?? null;
    const iv = encrypted?.iv ?? current?.api_key_iv ?? null;
    const enabled = body.enabled === true;
    if (enabled && (!ciphertext || !iv)) throw new ApiError(409, "AI_NOT_CONFIGURED", "API Key를 먼저 설정해 주세요.");
    const { error } = await admin.from("ai_provider_settings").upsert({ id: true, enabled, provider: "openai", model, api_key_ciphertext: ciphertext, api_key_iv: iv, encryption_version: 1, updated_by: user.id, updated_at: new Date().toISOString() });
    if (error) throw new ApiError(500, "AI_CONFIGURATION_FAILED", "AI 설정을 저장할 수 없습니다.");
    return json(request, status(await loadAIConfiguration(admin)));
  }
  if (action === "test") {
    if (!current?.api_key_ciphertext || !current.api_key_iv) throw new ApiError(409, "AI_NOT_CONFIGURED", "API Key를 먼저 설정해 주세요.");
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15_000);
    try { await callOpenAI({ apiKey: await decryptProviderKey(current.api_key_ciphertext, current.api_key_iv), model: current.model, prompt: "Return a short answer confirming availability.", signal: controller.signal }); }
    finally { clearTimeout(timeout); }
    return json(request, { connected: true });
  }
  throw new ApiError(400, "AI_ACTION_INVALID", "지원하지 않는 AI 설정 작업입니다.");
});
