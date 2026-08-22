import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { requireSystemAdmin } from "../_shared/auth.ts";
import { decryptGatewayKey, encryptGatewayKey, loadAIGateway, loadAIModel } from "../_shared/ai/configuration.ts";
import { callAIGateway, gatewayUrlOptions, normalizeGatewayBaseUrl } from "../_shared/ai/gateway.ts";
import { ApiError, json, readJson, serve } from "../_shared/http.ts";
import { requireText, requireUuid } from "../_shared/validation.ts";

const FAMILY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/u;

async function settings(admin: SupabaseClient) {
  const [{ data: gateway, error: gatewayError }, { data: models, error: modelError }] = await Promise.all([
    admin.from("ai_gateway_settings").select("enabled, base_url, api_key_ciphertext, api_key_iv, updated_at").eq("singleton", true).maybeSingle(),
    admin.from("ai_model_settings").select("id, family, model_id, display_name, enabled, is_default, sort_order, is_builtin, created_at, updated_at").order("sort_order").order("display_name")
  ]);
  if (gatewayError || modelError) throw new ApiError(500, "AI_CONFIGURATION_FAILED", "AI 설정을 확인할 수 없습니다.");
  return {
    gateway: {
      enabled: gateway?.enabled === true,
      baseUrl: typeof gateway?.base_url === "string" ? gateway.base_url : "",
      configured: Boolean(gateway?.api_key_ciphertext && gateway.api_key_iv),
      updatedAt: gateway?.updated_at ?? null
    },
    models: models ?? []
  };
}

function family(value: unknown): string {
  const resolved = requireText(value, "Family", 1, 40).toLowerCase();
  if (!FAMILY_PATTERN.test(resolved)) throw new ApiError(400, "AI_FAMILY_INVALID", "모델 Family가 올바르지 않습니다.");
  return resolved;
}

serve(async (request) => {
  const { user, admin } = await requireSystemAdmin(request);
  const body = await readJson<Record<string, unknown>>(request);
  const action = requireText(body.action, "작업", 1, 30);
  if (action === "get") return json(request, await settings(admin));

  const currentGateway = await loadAIGateway(admin);
  if (action === "save_gateway") {
    const baseUrl = normalizeGatewayBaseUrl(requireText(body.baseUrl, "Gateway Base URL", 8, 500), gatewayUrlOptions());
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    const encrypted = apiKey ? await encryptGatewayKey(requireText(apiKey, "Gateway API Key", 8, 4000)) : null;
    const ciphertext = encrypted?.ciphertext ?? currentGateway?.api_key_ciphertext ?? null;
    const iv = encrypted?.iv ?? currentGateway?.api_key_iv ?? null;
    const enabled = body.enabled === true;
    if (enabled && (!ciphertext || !iv)) throw new ApiError(409, "AI_NOT_CONFIGURED", "Gateway API Key를 먼저 설정해 주세요.");
    const { error } = await admin.from("ai_gateway_settings").upsert({ singleton: true, enabled, base_url: baseUrl, api_key_ciphertext: ciphertext, api_key_iv: iv, encryption_version: 1, updated_by: user.id, updated_at: new Date().toISOString() });
    if (error) throw new ApiError(500, "AI_CONFIGURATION_FAILED", "AI Gateway 설정을 저장할 수 없습니다.");
    return json(request, await settings(admin));
  }

  if (action === "add_model") {
    const modelId = requireText(body.modelId, "Model ID", 1, 160);
    const displayName = requireText(body.displayName, "표시 이름", 1, 100);
    const modelFamily = family(body.family);
    const { data: inserted, error } = await admin.from("ai_model_settings").insert({ family: modelFamily, model_id: modelId, display_name: displayName, enabled: body.enabled === true, is_default: false, sort_order: Number.isInteger(body.sortOrder) ? body.sortOrder : 2000, is_builtin: false, created_by: user.id, updated_by: user.id }).select("id").single();
    if (error || !inserted) throw new ApiError(error?.code === "23505" ? 409 : 500, error?.code === "23505" ? "AI_MODEL_DUPLICATE" : "AI_CONFIGURATION_FAILED", error?.code === "23505" ? "이미 등록된 Model ID입니다." : "AI 모델을 추가할 수 없습니다.");
    if (body.isDefault === true) {
      const { error: stateError } = await admin.rpc("set_ai_model_state", { p_model_setting_id: inserted.id, p_enabled: true, p_make_default: true });
      if (stateError) throw new ApiError(500, "AI_CONFIGURATION_FAILED", "기본 모델을 지정할 수 없습니다.");
    }
    return json(request, await settings(admin));
  }

  if (action === "update_model") {
    const modelSettingId = requireUuid(body.modelSettingId, "Model setting ID");
    const current = await loadAIModel(admin, modelSettingId);
    if (!current) throw new ApiError(404, "AI_MODEL_NOT_FOUND", "AI 모델을 찾을 수 없습니다.");
    const metadata: Record<string, unknown> = { updated_by: user.id };
    if (!current.is_builtin) {
      if (body.modelId !== undefined) metadata.model_id = requireText(body.modelId, "Model ID", 1, 160);
      if (body.displayName !== undefined) metadata.display_name = requireText(body.displayName, "표시 이름", 1, 100);
      if (body.family !== undefined) metadata.family = family(body.family);
    }
    if (body.sortOrder !== undefined) metadata.sort_order = Number.isInteger(body.sortOrder) ? body.sortOrder : current.sort_order;
    if (Object.keys(metadata).length > 1) {
      const { error } = await admin.from("ai_model_settings").update(metadata).eq("id", modelSettingId);
      if (error) throw new ApiError(error.code === "23505" ? 409 : 500, error.code === "23505" ? "AI_MODEL_DUPLICATE" : "AI_CONFIGURATION_FAILED", error.code === "23505" ? "이미 등록된 Model ID입니다." : "AI 모델을 수정할 수 없습니다.");
    }
    if (body.enabled !== undefined || body.isDefault === true) {
      const enabled = body.isDefault === true ? true : body.enabled === true;
      const { error } = await admin.rpc("set_ai_model_state", { p_model_setting_id: modelSettingId, p_enabled: enabled, p_make_default: body.isDefault === true });
      if (error?.code === "AIG03") throw new ApiError(409, "AI_DEFAULT_MODEL_REQUIRED", "다른 기본 모델을 먼저 지정해 주세요.");
      if (error) throw new ApiError(500, "AI_CONFIGURATION_FAILED", "AI 모델 상태를 수정할 수 없습니다.");
    }
    return json(request, await settings(admin));
  }

  if (action === "delete_model") {
    const modelSettingId = requireUuid(body.modelSettingId, "Model setting ID");
    const { data, error } = await admin.rpc("delete_custom_ai_model", { p_model_setting_id: modelSettingId });
    if (error?.code === "AIG05") throw new ApiError(409, "AI_BUILTIN_MODEL_PROTECTED", "기본 제공 모델은 비활성화만 할 수 있습니다.");
    if (error?.code === "AIG06") throw new ApiError(409, "AI_DEFAULT_MODEL_REQUIRED", "기본 모델은 삭제할 수 없습니다.");
    if (error || !data) throw new ApiError(500, "AI_CONFIGURATION_FAILED", "Custom 모델을 삭제할 수 없습니다.");
    return json(request, await settings(admin));
  }

  if (action === "test") {
    if (!currentGateway?.base_url || !currentGateway.api_key_ciphertext || !currentGateway.api_key_iv) throw new ApiError(409, "AI_NOT_CONFIGURED", "Gateway URL과 API Key를 먼저 설정해 주세요.");
    const { data: model } = await admin.from("ai_model_settings").select("model_id").eq("enabled", true).order("is_default", { ascending: false }).order("sort_order").limit(1).maybeSingle();
    if (!model) throw new ApiError(409, "AI_MODEL_REQUIRED", "활성 모델을 먼저 설정해 주세요.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      await callAIGateway({ baseUrl: currentGateway.base_url, apiKey: await decryptGatewayKey(currentGateway.api_key_ciphertext, currentGateway.api_key_iv), model: model.model_id, system: "Return only valid Rocket AI JSON with intent, kind, summary and tasks.", prompt: "Respond with intent chat, kind answer, a short availability summary, and an empty tasks array.", signal: controller.signal });
    } finally { clearTimeout(timeout); }
    return json(request, { connected: true });
  }
  throw new ApiError(400, "AI_ACTION_INVALID", "지원하지 않는 AI 설정 작업입니다.");
});
