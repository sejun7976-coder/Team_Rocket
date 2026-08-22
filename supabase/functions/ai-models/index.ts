import { requireReadyUser } from "../_shared/auth.ts";
import { ApiError, json, serve } from "../_shared/http.ts";

serve(async (request) => {
  const { admin } = await requireReadyUser(request);
  const { data, error } = await admin.from("ai_model_settings").select("id, provider, display_name, is_default, sort_order, ai_provider_settings!inner(enabled, api_key_ciphertext, api_key_iv)").eq("enabled", true).eq("ai_provider_settings.enabled", true).order("sort_order").order("display_name");
  if (error) throw new ApiError(500, "AI_CONFIGURATION_FAILED", "AI 모델 목록을 불러올 수 없습니다.");
  return json(request, { models: (data ?? []).filter((item) => { const setting = Array.isArray(item.ai_provider_settings) ? item.ai_provider_settings[0] : item.ai_provider_settings; return Boolean(setting?.api_key_ciphertext && setting.api_key_iv); }).map((item) => ({ id: item.id, provider: item.provider, displayName: item.display_name, isDefault: item.is_default })) });
});
