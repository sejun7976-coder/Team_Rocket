import { requireSystemAdmin } from "../_shared/auth.ts";
import { ApiError, json, readJson, serve } from "../_shared/http.ts";
import { requireUuid } from "../_shared/validation.ts";

serve(async (request) => {
  const { user: actor, admin } = await requireSystemAdmin(request);
  const body = await readJson<{ userId?: unknown; active?: unknown }>(request);
  const userId = requireUuid(body.userId, "User ID");
  if (typeof body.active !== "boolean") throw new ApiError(400, "INVALID_ACTIVE_STATE", "활성 상태가 올바르지 않습니다.");
  if (userId === actor.id && !body.active) throw new ApiError(400, "SELF_DEACTIVATE_DENIED", "현재 로그인한 관리자 계정은 비활성화할 수 없습니다.");

  const { data: authData, error: authReadError } = await admin.auth.admin.getUserById(userId);
  if (authReadError || !authData.user) throw new ApiError(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.");

  if (!body.active) {
    const { error: profileError } = await admin.from("profiles").update({ account_status: "inactive" }).eq("id", userId);
    if (profileError) throw new ApiError(500, "DEACTIVATE_FAILED", "사용자를 비활성화할 수 없습니다.");
    const { error: authError } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: "876000h",
      app_metadata: { ...authData.user.app_metadata, account_active: false }
    });
    if (authError) throw new ApiError(502, "AUTH_BAN_FAILED", "DB 접근은 차단했지만 Auth 로그인을 차단하지 못했습니다. 다시 시도하세요.");
  } else {
    const { error: authError } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: "none",
      app_metadata: { ...authData.user.app_metadata, account_active: true }
    });
    if (authError) throw new ApiError(502, "AUTH_UNBAN_FAILED", "Auth 계정을 재활성화할 수 없습니다.");
    const nextStatus = authData.user.app_metadata.must_change_password === false ? "active" : "password_change_required";
    const { error: profileError } = await admin.from("profiles").update({ account_status: nextStatus }).eq("id", userId);
    if (profileError) throw new ApiError(500, "REACTIVATE_FAILED", "Auth는 활성화되었지만 DB 접근은 계속 차단되어 있습니다. 다시 시도하세요.");
  }

  await admin.from("admin_audit_logs").insert({
    actor_id: actor.id,
    action: body.active ? "user_reactivated" : "user_deactivated",
    target_user_id: userId
  });
  return json(request, { active: body.active });
});
