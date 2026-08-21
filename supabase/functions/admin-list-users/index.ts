import { requireSystemAdmin } from "../_shared/auth.ts";
import { ApiError, json, serve } from "../_shared/http.ts";
import { deriveAdminUserStatus } from "../_shared/accountPolicy.ts";

serve(async (request) => {
  const { admin } = await requireSystemAdmin(request);
  const [{ data: profiles, error: profileError }, { data: authData, error: authError }] = await Promise.all([
    admin.from("profiles").select("id, student_id, name, github_username, system_role, account_status, created_at, first_login_completed_at, password_changed_at, key_reset_at").order("student_id"),
    admin.auth.admin.listUsers({ page: 1, perPage: 100 })
  ]);
  if (profileError || authError) throw new ApiError(500, "USER_LIST_FAILED", "사용자 목록을 불러올 수 없습니다.");

  const authUsers = new Map((authData?.users ?? []).map((authUser) => [authUser.id, authUser]));
  const users = (profiles ?? []).map((profile) => {
    const authUser = authUsers.get(profile.id);
    const mustChange = authUser?.app_metadata.must_change_password !== false;
    const status = deriveAdminUserStatus(profile.account_status, mustChange, authUser?.last_sign_in_at ?? null);
    return {
      ...profile,
      status,
      lastSignInAt: authUser?.last_sign_in_at ?? null
    };
  });
  return json(request, { users });
});
