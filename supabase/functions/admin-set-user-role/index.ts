import { requirePermission, requireReadyUser } from "../_shared/auth.ts";
import { ADMIN_PERMISSIONS } from "../_shared/adminPermissions.ts";
import { ApiError, json, readJson, serve } from "../_shared/http.ts";
import { requireUuid } from "../_shared/validation.ts";

type SystemRole = "user" | "admin";

function requireSystemRole(value: unknown): SystemRole {
  if (value !== "user" && value !== "admin") {
    throw new ApiError(400, "INVALID_SYSTEM_ROLE", "계정 유형이 올바르지 않습니다.");
  }
  return value;
}

serve(async (request) => {
  const context = await requireReadyUser(request);
  const { user: actor, admin } = await requirePermission(context, ADMIN_PERMISSIONS.USERS_CHANGE_ROLE);
  const body = await readJson<{ userId?: unknown; role?: unknown }>(request);
  const userId = requireUuid(body.userId, "User ID");
  const role = requireSystemRole(body.role);

  const [
    { data: target, error: targetError },
    { data: authData, error: authReadError },
    { data: permissionRows, error: permissionReadError },
  ] = await Promise.all([
    admin.from("profiles").select("id, system_role").eq("id", userId).maybeSingle(),
    admin.auth.admin.getUserById(userId),
    admin.from("user_admin_permissions").select("permission").eq("user_id", userId),
  ]);
  if (targetError || authReadError || permissionReadError || !target || !authData.user) {
    throw new ApiError(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.");
  }

  const previousRole = target.system_role as SystemRole;
  const previousPermissions = (permissionRows ?? []).map((row) => row.permission);
  const { error: roleError } = await admin.rpc("set_managed_system_role", {
    p_actor_id: actor.id,
    p_target_user_id: userId,
    p_new_role: role
  });
  if (roleError) {
    if (roleError.message.includes("LAST_SYSTEM_ADMIN")) {
      throw new ApiError(409, "LAST_SYSTEM_ADMIN", "마지막 활성 관리자의 권한은 해제할 수 없습니다.");
    }
    if (roleError.message.includes("PERMISSION_REQUIRED")) {
      throw new ApiError(403, "PERMISSION_REQUIRED", "계정 유형을 변경할 권한이 없습니다.");
    }
    if (roleError.message.includes("USER_NOT_FOUND")) {
      throw new ApiError(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.");
    }
    throw new ApiError(403, "ROLE_CHANGE_FORBIDDEN", "계정 유형을 변경할 수 없습니다.");
  }

  const { error: authError } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { ...authData.user.app_metadata, system_role: role }
  });
  if (authError) {
    if (previousRole !== role) {
      const { error: rollbackError } = await admin.rpc("restore_system_role_and_permissions_after_auth_failure", {
        p_actor_id: actor.id,
        p_target_user_id: userId,
        p_expected_role: role,
        p_restore_role: previousRole,
        p_restore_permissions: previousPermissions,
      });
      if (rollbackError) {
        throw new ApiError(500, "ROLE_CHANGE_INCONSISTENT", "권한 동기화에 실패했습니다. 시스템 상태를 확인해 주세요.");
      }
    }
    throw new ApiError(502, "AUTH_ROLE_UPDATE_FAILED", "인증 권한을 갱신하지 못해 기존 권한을 유지했습니다.");
  }

  return json(request, { userId, role });
});
