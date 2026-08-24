import { requirePermission, requireReadyUser } from "../_shared/auth.ts";
import { ADMIN_PERMISSIONS } from "../_shared/adminPermissions.ts";
import { deriveInitialAuthCredential } from "../_shared/authCredential.ts";
import { INITIAL_PASSWORD } from "../_shared/identity.ts";
import { ApiError, json, readJson, serve } from "../_shared/http.ts";
import { requireUuid } from "../_shared/validation.ts";

serve(async (request) => {
  const context = await requireReadyUser(request);
  const { user: actor, admin } = await requirePermission(context, ADMIN_PERMISSIONS.USERS_RESET_PASSWORD);
  const body = await readJson<{ userId?: unknown }>(request);
  const userId = requireUuid(body.userId, "User ID");
  if (userId === actor.id) throw new ApiError(400, "SELF_RESET_DENIED", "현재 로그인한 관리자 계정은 여기서 초기화할 수 없습니다.");

  const [{ data: targetAuth, error: authReadError }, { data: targetProfile, error: profileReadError }] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.from("profiles").select("id, student_id, account_status").eq("id", userId).single()
  ]);
  if (authReadError || profileReadError || !targetAuth.user || !targetProfile) {
    throw new ApiError(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.");
  }

  const { error: blockError } = await admin.from("profiles").update({
    account_status: "password_change_required",
    encryption_public_key: null,
    encrypted_private_key: null,
    key_salt: null,
    key_reset_at: new Date().toISOString()
  }).eq("id", userId);
  if (blockError) throw new ApiError(500, "PASSWORD_RESET_PREPARE_FAILED", "계정 접근을 먼저 차단할 수 없어 초기화를 중단했습니다.");
  const { error: keyError } = await admin.from("project_keys").delete().eq("user_id", userId);
  if (keyError) throw new ApiError(500, "PROJECT_KEY_REVOKE_FAILED", "프로젝트 암호화 키를 폐기할 수 없어 초기화를 중단했습니다.");

  const authCredential = await deriveInitialAuthCredential(targetProfile.student_id);
  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    password: authCredential,
    app_metadata: {
      ...targetAuth.user.app_metadata,
      must_change_password: true,
      account_active: true
    }
  });
  if (updateError) {
    throw new ApiError(502, "AUTH_PASSWORD_RESET_FAILED", "Auth 비밀번호 초기화에 실패했습니다. 계정은 안전을 위해 차단되었으며 다시 시도해야 합니다.");
  }

  await admin.from("admin_audit_logs").insert({
    actor_id: actor.id,
    action: "password_reset",
    target_user_id: userId,
    details: { student_id: targetProfile.student_id, project_keys_revoked: true }
  });
  return json(request, {
    reset: true,
    initialPassword: INITIAL_PASSWORD,
    sessionsInvalidatedByDataPolicy: true,
    projectKeyRewrapRequired: true
  });
});
