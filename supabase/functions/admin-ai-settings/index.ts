import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { requirePermission, requireReadyUser } from "../_shared/auth.ts";
import { ADMIN_PERMISSIONS } from "../_shared/adminPermissions.ts";
import { callGateway, GatewayError } from "../_shared/ai/gateway.ts";
import { AI_MODEL_CATALOG, findAIModel } from "../_shared/ai/modelCatalog.ts";
import { ApiError, json, readJson, serve } from "../_shared/http.ts";
import { requireText, requireUuid } from "../_shared/validation.ts";

function gatewaySecrets(): { baseUrl: string; apiKey: string } {
  const baseUrl = Deno.env.get("AI_GATEWAY_BASE_URL")?.trim() ?? "";
  const apiKey = Deno.env.get("AI_GATEWAY_API_KEY")?.trim() ?? "";
  if (!baseUrl || !apiKey) throw new ApiError(409, "AI_NOT_CONFIGURED", "AI Gateway Secret이 설정되지 않았습니다.");
  return { baseUrl, apiKey };
}

function gatewayFailure(error: unknown): ApiError {
  if (error instanceof GatewayError && error.code === "TIMEOUT") {
    return new ApiError(504, "AI_GATEWAY_TIMEOUT", "AI Gateway 응답 시간이 초과되었습니다.");
  }
  return new ApiError(502, "AI_GATEWAY_FAILED", "AI Gateway에 연결하지 못했습니다.");
}

async function settings(admin: SupabaseClient) {
  const [{ data, error }, { data: runtime, error: runtimeError }] = await Promise.all([
    admin.from("ai_model_settings")
      .select("model_id, enabled, is_default")
      .order("sort_order"),
    admin.from("ai_runtime_settings").select("guard_model_id").eq("singleton", true).maybeSingle(),
  ]);
  if (error || runtimeError) throw new ApiError(500, "AI_SETTINGS_FAILED", "AI 설정을 불러올 수 없습니다.");
  const state = new Map((data ?? []).map((row) => [String(row.model_id), row]));
  return {
    gateway: {
      configured: Boolean(Deno.env.get("AI_GATEWAY_BASE_URL")?.trim() && Deno.env.get("AI_GATEWAY_API_KEY")?.trim()),
    },
    guardModelId: runtime?.guard_model_id ?? null,
    models: AI_MODEL_CATALOG.map((model) => ({
      modelId: model.id,
      displayName: model.displayName,
      family: model.family,
      sortOrder: model.sortOrder,
      enabled: state.get(model.id)?.enabled === true,
      isDefault: state.get(model.id)?.is_default === true,
    })),
  };
}

serve(async (request) => {
  const context = await requireReadyUser(request);
  const { user, admin } = await requirePermission(context, ADMIN_PERMISSIONS.AI_MANAGE);
  const body = await readJson<Record<string, unknown>>(request, 8_192);
  const action = requireText(body.action, "작업", 1, 30);
  if (action === "get") return json(request, await settings(admin));

  if (action === "list_users") {
    const [{ data: profiles, error: profileError }, { data: statuses, error: statusError }] = await Promise.all([
      admin.from("profiles").select("id, student_id, name, system_role, account_status").order("name"),
      admin.from("ai_user_policy_status").select("user_id, warning_count, suspended, suspended_at, suspension_reason, last_warning_at, last_ai_used_at"),
    ]);
    if (profileError || statusError) throw new ApiError(500, "AI_USERS_FAILED", "AI 사용자 상태를 불러올 수 없습니다.");
    const statusByUser = new Map((statuses ?? []).map((status) => [status.user_id, status]));
    return json(request, {
      users: (profiles ?? []).map((profile) => ({
        ...profile,
        warningCount: statusByUser.get(profile.id)?.warning_count ?? 0,
        suspended: statusByUser.get(profile.id)?.suspended ?? false,
        suspendedAt: statusByUser.get(profile.id)?.suspended_at ?? null,
        suspensionReason: statusByUser.get(profile.id)?.suspension_reason ?? null,
        lastWarningAt: statusByUser.get(profile.id)?.last_warning_at ?? null,
        lastAiUsedAt: statusByUser.get(profile.id)?.last_ai_used_at ?? null,
      })),
    });
  }

  if (action === "set_model") {
    const modelId = requireText(body.modelId, "Model ID", 1, 160);
    if (!findAIModel(modelId)) throw new ApiError(400, "AI_MODEL_UNKNOWN", "지원하지 않는 AI 모델입니다.");
    if (typeof body.enabled !== "boolean" || typeof body.makeDefault !== "boolean") {
      throw new ApiError(400, "AI_MODEL_STATE_INVALID", "AI 모델 상태가 올바르지 않습니다.");
    }
    const { error } = await admin.rpc("set_ai_model_state_by_actor", {
      p_actor_id: user.id,
      p_model_id: modelId,
      p_enabled: body.enabled,
      p_make_default: body.makeDefault,
    });
    if (error?.message.includes("PERMISSION_REQUIRED")) {
      throw new ApiError(403, "PERMISSION_REQUIRED", "AI 설정을 관리할 권한이 없습니다.");
    }
    if (error?.message.includes("AI_MODEL_NOT_FOUND")) {
      throw new ApiError(404, "AI_MODEL_NOT_FOUND", "AI 모델을 찾을 수 없습니다.");
    }
    if (error) throw new ApiError(500, "AI_MODEL_UPDATE_FAILED", "AI 모델 설정을 변경하지 못했습니다.");
    return json(request, await settings(admin));
  }

  if (action === "set_guard_model") {
    const modelId = requireText(body.modelId, "Model ID", 1, 160);
    if (!findAIModel(modelId)) throw new ApiError(400, "AI_MODEL_UNKNOWN", "지원하지 않는 AI 모델입니다.");
    const { error } = await admin.rpc("set_ai_guard_model_by_actor", {
      p_actor_id: user.id,
      p_model_id: modelId,
    });
    if (error?.message.includes("PERMISSION_REQUIRED")) {
      throw new ApiError(403, "PERMISSION_REQUIRED", "AI 설정을 관리할 권한이 없습니다.");
    }
    if (error?.message.includes("AI_GUARD_MODEL_UNAVAILABLE")) {
      throw new ApiError(409, "AI_GUARD_MODEL_UNAVAILABLE", "Guard Model은 활성 모델 중에서 선택해야 합니다.");
    }
    if (error) throw new ApiError(500, "AI_GUARD_MODEL_UPDATE_FAILED", "Guard Model을 변경하지 못했습니다.");
    return json(request, await settings(admin));
  }

  if (action === "reset_user_policy") {
    const targetUserId = requireUuid(body.userId, "User ID");
    const { error } = await admin.rpc("reset_ai_user_policy_by_actor", {
      p_actor_id: user.id,
      p_target_user_id: targetUserId,
    });
    if (error?.message.includes("PERMISSION_REQUIRED")) {
      throw new ApiError(403, "PERMISSION_REQUIRED", "AI 사용 제한을 해제할 권한이 없습니다.");
    }
    if (error?.message.includes("USER_NOT_FOUND")) {
      throw new ApiError(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.");
    }
    if (error) throw new ApiError(500, "AI_POLICY_RESET_FAILED", "AI 사용 제한을 해제하지 못했습니다.");
    return json(request, { reset: true });
  }

  if (action === "test") {
    const secrets = gatewaySecrets();
    const { data: rows, error } = await admin
      .from("ai_model_settings")
      .select("model_id, is_default, sort_order")
      .eq("enabled", true)
      .order("is_default", { ascending: false })
      .order("sort_order")
      .limit(20);
    if (error) throw new ApiError(500, "AI_SETTINGS_FAILED", "AI 설정을 확인할 수 없습니다.");
    const model = (rows ?? []).find((row) => findAIModel(row.model_id));
    if (!model) throw new ApiError(409, "AI_MODEL_REQUIRED", "활성 AI 모델을 먼저 선택해 주세요.");
    try {
      await callGateway({
        ...secrets,
        model: model.model_id,
        timeoutMs: 15_000,
        messages: [
          { role: "system", content: "Return only JSON." },
          { role: "user", content: '{"message":"연결됨","actions":[]}' },
        ],
      });
    } catch (gatewayError) {
      throw gatewayFailure(gatewayError);
    }
    return json(request, { connected: true });
  }

  throw new ApiError(400, "AI_SETTINGS_ACTION_INVALID", "지원하지 않는 AI 설정 작업입니다.");
});
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
