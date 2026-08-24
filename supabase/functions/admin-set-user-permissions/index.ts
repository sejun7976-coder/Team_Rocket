import { requirePermission, requireReadyUser } from "../_shared/auth.ts";
import {
  ADMIN_PERMISSIONS,
  isAdminPermission,
  type AdminPermission,
} from "../_shared/adminPermissions.ts";
import { ApiError, json, readJson, serve } from "../_shared/http.ts";
import { requireUuid } from "../_shared/validation.ts";

interface RequestBody {
  userId?: unknown;
  permissions?: unknown;
}

function requirePermissions(value: unknown): AdminPermission[] {
  if (!Array.isArray(value) || value.length > 50 || value.some((item) => !isAdminPermission(item))) {
    throw new ApiError(400, "INVALID_PERMISSIONS", "기능 권한 목록이 올바르지 않습니다.");
  }
  return [...new Set(value as AdminPermission[])];
}

serve(async (request) => {
  const context = await requireReadyUser(request);
  const { user: actor, admin } = await requirePermission(
    context,
    ADMIN_PERMISSIONS.USERS_MANAGE_PERMISSIONS,
  );
  const body = await readJson<RequestBody>(request, 8_192);
  const userId = requireUuid(body.userId, "User ID");
  const permissions = [...new Set([
    ...requirePermissions(body.permissions),
    ADMIN_PERMISSIONS.AI_USE,
  ])];

  const { data, error } = await admin.rpc("set_user_permissions", {
    p_actor_id: actor.id,
    p_target_user_id: userId,
    p_permissions: permissions,
  });
  if (error) {
    if (error.message.includes("USER_NOT_FOUND")) {
      throw new ApiError(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.");
    }
    if (error.message.includes("LAST_PERMISSION_MANAGER")) {
      throw new ApiError(409, "LAST_PERMISSION_MANAGER", "마지막 권한 관리자의 권한 변경 권한은 해제할 수 없습니다.");
    }
    if (error.message.includes("PERMISSION_REQUIRED")) {
      throw new ApiError(403, "PERMISSION_REQUIRED", "기능 권한을 변경할 권한이 없습니다.");
    }
    throw new ApiError(500, "PERMISSIONS_UPDATE_FAILED", "기능 권한을 변경하지 못했습니다.");
  }

  return json(request, {
    userId,
    permissions: Array.isArray(data) ? data : permissions,
  });
});
