import { requireSystemAdmin } from "../_shared/auth.ts";
import { ApiError, json, serve } from "../_shared/http.ts";
import { deriveAdminUserStatus } from "../_shared/accountPolicy.ts";
import { describeUserAgent } from "../_shared/accessLog.ts";

serve(async (request) => {
  const { user: actor, admin } = await requireSystemAdmin(request);
  const retentionStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const countStart = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const [{ data: profiles, error: profileError }, { data: authData, error: authError }, { data: accessLogs, error: accessError }, authSummaryResult] = await Promise.all([
    admin.from("profiles").select("id, student_id, name, github_username, system_role, account_status, created_at, first_login_completed_at, password_changed_at, key_reset_at").order("student_id"),
    admin.auth.admin.listUsers({ page: 1, perPage: 100 }),
    admin.from("user_access_logs")
      .select("user_id, event_type, ip_address, country_code, user_agent, created_at")
      .gte("created_at", retentionStart)
      .order("created_at", { ascending: false }),
    admin.rpc("summarize_auth_audit_logins_admin", { p_actor_id: actor.id })
  ]);
  if (profileError || authError || accessError) throw new ApiError(500, "USER_LIST_FAILED", "사용자 목록을 불러올 수 없습니다.");

  const authUsers = new Map((authData?.users ?? []).map((authUser) => [authUser.id, authUser]));
  const authSummary = new Map((authSummaryResult.error ? [] : authSummaryResult.data ?? []).map((summary) => [summary.user_id, summary]));
  const accessByUser = new Map<string, typeof accessLogs>();
  for (const log of accessLogs ?? []) {
    const current = accessByUser.get(log.user_id) ?? [];
    current.push(log);
    accessByUser.set(log.user_id, current);
  }
  const users = (profiles ?? []).map((profile) => {
    const authUser = authUsers.get(profile.id);
    const userLogs = accessByUser.get(profile.id) ?? [];
    const recent = userLogs[0];
    const authoritativeAccess = authSummary.get(profile.id);
    const mustChange = authUser?.app_metadata.must_change_password !== false;
    const status = deriveAdminUserStatus(profile.account_status, mustChange, authUser?.last_sign_in_at ?? null);
    return {
      ...profile,
      status,
      lastSignInAt: authUser?.last_sign_in_at ?? null,
      recentIpAddress: authoritativeAccess?.recent_ip_address ?? recent?.ip_address ?? null,
      recentCountryCode: recent?.country_code ?? null,
      recentDevice: describeUserAgent(authoritativeAccess?.recent_user_agent ?? recent?.user_agent ?? null),
      loginCount30Days: authoritativeAccess
        ? Number(authoritativeAccess.login_count_30_days)
        : userLogs.filter((log) => log.event_type === "login" && Date.parse(log.created_at) >= countStart).length
    };
  });
  return json(request, { users });
});
