import { describeUserAgent, isAccessEventType, type AccessEventType } from "../_shared/accessLog.ts";
import { requirePermission, requireReadyUser } from "../_shared/auth.ts";
import { ADMIN_PERMISSIONS } from "../_shared/adminPermissions.ts";
import { ApiError, json, readJson, serve } from "../_shared/http.ts";
import { requireUuid } from "../_shared/validation.ts";

interface RequestBody {
  userId?: unknown;
  eventType?: unknown;
  from?: unknown;
  to?: unknown;
  limit?: unknown;
  offset?: unknown;
}

interface AccessRow {
  id: string;
  user_id: string;
  event_type: string;
  ip_address: string | null;
  country_code?: string | null;
  user_agent: string | null;
  created_at: string;
}

interface NormalizedLog {
  id: string;
  source: "auth" | "app";
  eventType: AccessEventType;
  ipAddress: string | null;
  countryCode: string | null;
  device: string | null;
  createdAt: string;
}

function optionalDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 40 || Number.isNaN(Date.parse(value))) {
    throw new ApiError(400, "ACCESS_LOG_FILTER_INVALID", `${field} 필터가 올바르지 않습니다.`);
  }
  return new Date(value).toISOString();
}

function authEvent(eventType: AccessEventType | null): string | null {
  if (eventType === "password_changed") return "user_updated_password";
  if (eventType === "session_refreshed") return "token_refreshed";
  return eventType;
}

function normalizedEvent(eventType: string): AccessEventType | null {
  if (eventType === "user_updated_password") return "password_changed";
  if (eventType === "token_refreshed") return "session_refreshed";
  return isAccessEventType(eventType) ? eventType : null;
}

serve(async (request) => {
  const context = await requireReadyUser(request);
  const { user: actor, admin } = await requirePermission(context, ADMIN_PERMISSIONS.ACCESS_LOGS_VIEW);
  const body = await readJson<RequestBody>(request, 4_096);
  const userId = requireUuid(body.userId, "User ID");
  const eventType = body.eventType === undefined || body.eventType === null || body.eventType === ""
    ? null
    : isAccessEventType(body.eventType) ? body.eventType : null;
  if (body.eventType && !eventType) throw new ApiError(400, "ACCESS_LOG_FILTER_INVALID", "이벤트 필터가 올바르지 않습니다.");
  const requestedFrom = optionalDate(body.from, "시작일");
  const retentionFloor = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const from = requestedFrom && requestedFrom > retentionFloor ? requestedFrom : retentionFloor;
  const to = optionalDate(body.to, "종료일");
  if (from && to && from > to) throw new ApiError(400, "ACCESS_LOG_FILTER_INVALID", "조회 기간이 올바르지 않습니다.");
  const limit = body.limit === undefined ? 50 : Number(body.limit);
  const offset = body.offset === undefined ? 0 : Number(body.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(offset) || offset < 0 || offset > 450) {
    throw new ApiError(400, "ACCESS_LOG_PAGINATION_INVALID", "페이지 범위가 올바르지 않습니다.");
  }
  const fetchLimit = limit + offset + 1;

  let appQuery = admin.from("user_access_logs")
    .select("id, user_id, event_type, ip_address, country_code, user_agent, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(fetchLimit);
  if (eventType) appQuery = appQuery.eq("event_type", eventType);
  if (from) appQuery = appQuery.gte("created_at", from);
  if (to) appQuery = appQuery.lte("created_at", to);

  const [appResult, authResult] = await Promise.all([
    appQuery,
    admin.rpc("list_auth_audit_logs_admin", {
      p_actor_id: actor.id,
      p_user_id: userId,
      p_event_type: authEvent(eventType),
      p_from: from,
      p_to: to,
      p_limit: fetchLimit,
      p_offset: 0
    })
  ]);
  if (appResult.error) throw new ApiError(500, "ACCESS_LOG_LIST_FAILED", "접속 기록을 불러올 수 없습니다.");
  // Auth DB audit storage may be disabled. In that case the app log remains a
  // safe fallback; other RPC errors are deliberately not exposed to the UI.
  const appRows = (appResult.data ?? []) as AccessRow[];
  const authRows = authResult.error ? [] : (authResult.data ?? []) as AccessRow[];
  const usedAppIds = new Set<string>();
  const combined: NormalizedLog[] = authRows.flatMap((authRow): NormalizedLog[] => {
    const type = normalizedEvent(authRow.event_type);
    if (!type) return [];
    const authTime = Date.parse(authRow.created_at);
    const match = appRows.find((appRow) =>
      !usedAppIds.has(appRow.id)
      && appRow.event_type === type
      && Math.abs(Date.parse(appRow.created_at) - authTime) <= 120_000
    );
    if (match) usedAppIds.add(match.id);
    const userAgent = authRow.user_agent ?? match?.user_agent ?? null;
    return [{
      id: `auth:${authRow.id}`,
      source: "auth" as const,
      eventType: type,
      ipAddress: authRow.ip_address ?? match?.ip_address ?? null,
      countryCode: match?.country_code ?? null,
      device: describeUserAgent(userAgent),
      createdAt: authRow.created_at
    }];
  });
  for (const appRow of appRows) {
    if (usedAppIds.has(appRow.id)) continue;
    combined.push({
      id: `app:${appRow.id}`,
      source: "app",
      eventType: appRow.event_type as AccessEventType,
      ipAddress: appRow.ip_address,
      countryCode: appRow.country_code ?? null,
      device: describeUserAgent(appRow.user_agent),
      createdAt: appRow.created_at
    });
  }
  combined.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const page = combined.slice(offset, offset + limit);
  return json(request, { logs: page, hasMore: combined.length > offset + limit });
});
