import { accessMetadataFromRequest, isAccessEventType } from "../_shared/accessLog.ts";
import { requireUser } from "../_shared/auth.ts";
import { ApiError, json, readJson, serve } from "../_shared/http.ts";

interface RequestBody {
  eventType?: unknown;
}

serve(async (request) => {
  const { user, admin } = await requireUser(request);
  const body = await readJson<RequestBody>(request, 1_024);
  if (!isAccessEventType(body.eventType)) {
    throw new ApiError(400, "ACCESS_EVENT_INVALID", "접속 이벤트 형식이 올바르지 않습니다.");
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("account_status")
    .eq("id", user.id)
    .single();
  if (profileError || !profile) throw new ApiError(403, "PROFILE_REQUIRED", "사용자 프로필을 확인할 수 없습니다.");
  if (profile.account_status === "inactive" || user.app_metadata.account_active === false) {
    throw new ApiError(403, "ACCOUNT_INACTIVE", "비활성화된 계정입니다.");
  }

  const metadata = accessMetadataFromRequest(request);
  const { error } = await admin.rpc("record_user_access_event", {
    p_user_id: user.id,
    p_event_type: body.eventType,
    p_ip_address: metadata.ipAddress,
    p_country_code: metadata.countryCode,
    p_user_agent: metadata.userAgent
  });
  if (error) throw new ApiError(500, "ACCESS_EVENT_STORE_FAILED", "접속 기록을 저장할 수 없습니다.");
  return json(request, { recorded: true }, 202);
});
