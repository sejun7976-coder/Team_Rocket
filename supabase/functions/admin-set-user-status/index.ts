import { requirePermission, requireReadyUser } from "../_shared/auth.ts";
import { ADMIN_PERMISSIONS } from "../_shared/adminPermissions.ts";
import { ApiError, json, readJson, serve } from "../_shared/http.ts";
import { requireUuid } from "../_shared/validation.ts";

serve(async (request) => {
  const context = await requireReadyUser(request);
  const { user: actor, admin } = await requirePermission(context, ADMIN_PERMISSIONS.USERS_CHANGE_STATUS);
  const body = await readJson<{ userId?: unknown; active?: unknown }>(request);
  const userId = requireUuid(body.userId, "User ID");
  if (typeof body.active !== "boolean") throw new ApiError(400, "INVALID_ACTIVE_STATE", "활성 상태가 올바르지 않습니다.");
  if (userId === actor.id && !body.active) throw new ApiError(400, "SELF_DEACTIVATE_DENIED", "현재 로그인한 관리자 계정은 비활성화할 수 없습니다.");

  const { data: authData, error: authReadError } = await admin.auth.admin.getUserById(userId);
  if (authReadError || !authData.user) throw new ApiError(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.");

  const setManagedStatus = async (status: "password_change_required" | "active" | "inactive") => {
    const { error } = await admin.rpc("set_managed_account_status", {
      p_actor_id: actor.id,
      p_target_user_id: userId,
      p_next_status: status,
    });
    if (!error) return;
    if (error.message.includes("LAST_SYSTEM_ADMIN")) {
      throw new ApiError(409, "LAST_SYSTEM_ADMIN", "마지막 활성 관리자는 비활성화할 수 없습니다.");
    }
    if (error.message.includes("LAST_PERMISSION_MANAGER")) {
      throw new ApiError(409, "LAST_PERMISSION_MANAGER", "마지막 권한 관리자는 비활성화할 수 없습니다.");
    }
    if (error.message.includes("PERMISSION_REQUIRED")) {
      throw new ApiError(403, "PERMISSION_REQUIRED", "사용자 상태를 변경할 권한이 없습니다.");
    }
    if (error.message.includes("USER_NOT_FOUND")) {
      throw new ApiError(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.");
    }
    throw new ApiError(500, "ACCOUNT_STATUS_UPDATE_FAILED", "사용자 상태를 변경할 수 없습니다.");
  };

  if (!body.active) {
    await setManagedStatus("inactive");
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
    await setManagedStatus(nextStatus);
  }

  await admin.from("admin_audit_logs").insert({
    actor_id: actor.id,
    action: body.active ? "user_reactivated" : "user_deactivated",
    target_user_id: userId
  });
  return json(request, { active: body.active });
});
