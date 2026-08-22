import { requireReadyUser } from "../_shared/auth.ts";
import { ApiError, json, serve } from "../_shared/http.ts";

serve(async (request) => {
  const { admin } = await requireReadyUser(request);
  const [{ data: gateway, error: gatewayError }, { data, error }] = await Promise.all([
    admin.from("ai_gateway_settings").select("enabled, api_key_ciphertext, api_key_iv").eq("singleton", true).maybeSingle(),
    admin.from("ai_model_settings").select("id, model_id, family, display_name, is_default, sort_order").eq("enabled", true).order("sort_order").order("display_name")
  ]);
  if (gatewayError || error) throw new ApiError(500, "AI_CONFIGURATION_FAILED", "AI 모델 목록을 불러올 수 없습니다.");
  if (!gateway?.enabled || !gateway.api_key_ciphertext || !gateway.api_key_iv) return json(request, { models: [] });
  return json(request, { models: (data ?? []).map((item) => ({ id: item.id, modelId: item.model_id, family: item.family, displayName: item.display_name, isDefault: item.is_default })) });
});
