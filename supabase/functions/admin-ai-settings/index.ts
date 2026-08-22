import { requireSystemAdmin } from "../_shared/auth.ts";
import { decryptProviderKey, encryptProviderKey, isAIProvider, loadAIConfiguration } from "../_shared/ai/configuration.ts";
import { callAIProvider } from "../_shared/ai/provider.ts";
import { ApiError, json, readJson, serve } from "../_shared/http.ts";
import { requireText, requireUuid } from "../_shared/validation.ts";

interface ProviderRow { provider: string; enabled: boolean; api_key_ciphertext: string | null; api_key_iv: string | null; updated_at: string }
async function settings(admin: SupabaseClient) {
  const [{ data: providers, error: providerError }, { data: models, error: modelError }] = await Promise.all([
    admin.from("ai_provider_settings").select("provider, enabled, api_key_ciphertext, api_key_iv, updated_at").order("provider"),
    admin.from("ai_model_settings").select("id, provider, model_id, display_name, enabled, is_default, sort_order, created_at, updated_at").order("sort_order").order("display_name")
  ]);
  if (providerError || modelError) throw new ApiError(500, "AI_CONFIGURATION_FAILED", "AI 설정을 확인할 수 없습니다.");
  return { providers: ((providers ?? []) as ProviderRow[]).map((item) => ({ provider: item.provider, enabled: item.enabled, configured: Boolean(item.api_key_ciphertext && item.api_key_iv), updatedAt: item.updated_at })), models: models ?? [] };
}

serve(async (request) => {
  const { user, admin } = await requireSystemAdmin(request);
  const body = await readJson<Record<string, unknown>>(request);
  const action = requireText(body.action, "작업", 1, 30);
  if (action === "get") return json(request, await settings(admin));
  if (!isAIProvider(body.provider)) throw new ApiError(400, "AI_PROVIDER_INVALID", "지원하지 않는 AI provider입니다.");
  const provider = body.provider;
  const current = await loadAIConfiguration(admin, provider);
  if (action === "save_provider") {
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    const encrypted = apiKey ? await encryptProviderKey(apiKey) : null;
    const ciphertext = encrypted?.ciphertext ?? current?.api_key_ciphertext ?? null;
    const iv = encrypted?.iv ?? current?.api_key_iv ?? null;
    const enabled = body.enabled === true;
    if (enabled && (!ciphertext || !iv)) throw new ApiError(409, "AI_NOT_CONFIGURED", "API Key를 먼저 설정해 주세요.");
    const { error } = await admin.from("ai_provider_settings").upsert({ provider, enabled, api_key_ciphertext: ciphertext, api_key_iv: iv, encryption_version: 1, updated_by: user.id, updated_at: new Date().toISOString() });
    if (error) throw new ApiError(500, "AI_CONFIGURATION_FAILED", "AI provider 설정을 저장할 수 없습니다.");
    return json(request, await settings(admin));
  }
  if (action === "delete_key") {
    const { error } = await admin.from("ai_provider_settings").update({ enabled: false, api_key_ciphertext: null, api_key_iv: null, updated_by: user.id }).eq("provider", provider);
    if (error) throw new ApiError(500, "AI_CONFIGURATION_FAILED", "AI API Key를 삭제할 수 없습니다.");
    return json(request, await settings(admin));
  }
  if (action === "add_model") {
    const modelId = requireText(body.modelId, "Model ID", 1, 160);
    const displayName = requireText(body.displayName, "표시 이름", 1, 100);
    const isDefault = body.isDefault === true;
    if (isDefault) await admin.from("ai_model_settings").update({ is_default: false, updated_by: user.id }).eq("provider", provider);
    const { error } = await admin.from("ai_model_settings").insert({ provider, model_id: modelId, display_name: displayName, enabled: body.enabled !== false, is_default: isDefault, sort_order: Number.isInteger(body.sortOrder) ? body.sortOrder : 0, created_by: user.id, updated_by: user.id });
    if (error) throw new ApiError(error.code === "23505" ? 409 : 500, error.code === "23505" ? "AI_MODEL_DUPLICATE" : "AI_CONFIGURATION_FAILED", error.code === "23505" ? "이미 등록된 모델입니다." : "AI 모델을 추가할 수 없습니다.");
    return json(request, await settings(admin));
  }
  if (action === "update_model") {
    const modelSettingId = requireUuid(body.modelSettingId, "Model setting ID");
    const updates: Record<string, unknown> = { updated_by: user.id };
    if (body.modelId !== undefined) updates.model_id = requireText(body.modelId, "Model ID", 1, 160);
    if (body.displayName !== undefined) updates.display_name = requireText(body.displayName, "표시 이름", 1, 100);
    if (body.enabled !== undefined) updates.enabled = body.enabled === true;
    if (body.sortOrder !== undefined) updates.sort_order = Number.isInteger(body.sortOrder) ? body.sortOrder : 0;
    if (body.isDefault === true) { await admin.from("ai_model_settings").update({ is_default: false, updated_by: user.id }).eq("provider", provider); updates.is_default = true; }
    else if (body.isDefault === false) updates.is_default = false;
    const { error } = await admin.from("ai_model_settings").update(updates).eq("id", modelSettingId).eq("provider", provider);
    if (error) throw new ApiError(500, "AI_CONFIGURATION_FAILED", "AI 모델을 수정할 수 없습니다.");
    return json(request, await settings(admin));
  }
  if (action === "delete_model") {
    const modelSettingId = requireUuid(body.modelSettingId, "Model setting ID");
    const { error } = await admin.from("ai_model_settings").delete().eq("id", modelSettingId).eq("provider", provider);
    if (error) throw new ApiError(500, "AI_CONFIGURATION_FAILED", "AI 모델을 삭제할 수 없습니다.");
    return json(request, await settings(admin));
  }
  if (action === "test") {
    if (!current?.api_key_ciphertext || !current.api_key_iv) throw new ApiError(409, "AI_NOT_CONFIGURED", "API Key를 먼저 설정해 주세요.");
    const { data: model } = await admin.from("ai_model_settings").select("model_id").eq("provider", provider).eq("enabled", true).order("is_default", { ascending: false }).order("sort_order").limit(1).maybeSingle();
    if (!model) throw new ApiError(409, "AI_MODEL_REQUIRED", "활성 모델을 먼저 등록해 주세요.");
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15_000);
    try { await callAIProvider(provider, { apiKey: await decryptProviderKey(current.api_key_ciphertext, current.api_key_iv), model: model.model_id, system: "Return only Rocket AI JSON.", prompt: "Respond with an answer confirming availability.", signal: controller.signal }); }
    finally { clearTimeout(timeout); }
    return json(request, { connected: true });
  }
  throw new ApiError(400, "AI_ACTION_INVALID", "지원하지 않는 AI 설정 작업입니다.");
});
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
