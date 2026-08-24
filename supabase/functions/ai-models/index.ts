import { requirePermission, requireReadyUser } from "../_shared/auth.ts";
import { ADMIN_PERMISSIONS } from "../_shared/adminPermissions.ts";
import { AI_MODEL_CATALOG } from "../_shared/ai/modelCatalog.ts";
import { ApiError, json, serve } from "../_shared/http.ts";

serve(async (request) => {
  const context = await requireReadyUser(request);
  const { admin } = await requirePermission(context, ADMIN_PERMISSIONS.AI_USE);
  const { data, error } = await admin
    .from("ai_model_settings")
    .select("model_id, enabled, is_default")
    .eq("enabled", true);
  if (error) throw new ApiError(500, "AI_MODELS_FAILED", "AI 모델 목록을 불러올 수 없습니다.");
  const state = new Map((data ?? []).map((row) => [row.model_id as string, row]));
  return json(request, {
    models: AI_MODEL_CATALOG
      .filter((model) => state.has(model.id))
      .map((model) => ({
        modelId: model.id,
        displayName: model.displayName,
        family: model.family,
        isDefault: state.get(model.id)?.is_default === true,
      })),
  });
});
