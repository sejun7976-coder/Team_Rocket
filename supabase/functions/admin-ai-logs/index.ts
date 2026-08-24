import { requirePermission, requireSystemAdmin } from "../_shared/auth.ts";
import { ADMIN_PERMISSIONS } from "../_shared/adminPermissions.ts";
import { findAIModel } from "../_shared/ai/modelCatalog.ts";
import { ApiError, json, readJson, serve } from "../_shared/http.ts";
import { requireText, requireUuid } from "../_shared/validation.ts";

const POLICY_STATUSES = new Set([
  "normal", "uncertain", "warning", "bypass", "output_blocked", "suspended", "guard_error", "unsupported",
]);

serve(async (request) => {
  const context = await requireSystemAdmin(request);
  const { admin } = await requirePermission(context, ADMIN_PERMISSIONS.AI_LOGS_VIEW);
  const body = await readJson<Record<string, unknown>>(request, 16_384);
  const action = requireText(body.action, "작업", 1, 40);

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

  if (action === "filters") {
    const { data, error } = await admin.from("ai_conversations")
      .select("user_id, user_name_snapshot, project_id, project_name_snapshot, model_id")
      .order("created_at", { ascending: false })
      .limit(1_000);
    if (error) throw new ApiError(500, "AI_LOG_FILTERS_FAILED", "AI 대화 필터를 불러올 수 없습니다.");
    const users = new Map<string, string>();
    const projects = new Map<string, string>();
    const models = new Set<string>();
    for (const row of data ?? []) {
      if (row.user_id) users.set(row.user_id, row.user_name_snapshot);
      if (row.project_id) projects.set(row.project_id, row.project_name_snapshot);
      if (findAIModel(row.model_id)) models.add(row.model_id);
    }
    return json(request, {
      users: [...users].map(([id, name]) => ({ id, name })),
      projects: [...projects].map(([id, name]) => ({ id, name })),
      models: [...models],
      statuses: [...POLICY_STATUSES],
    });
  }

  if (action === "list_conversations") {
    const limit = typeof body.limit === "number" && Number.isInteger(body.limit)
      ? Math.min(Math.max(body.limit, 1), 100)
      : 50;
    let query = admin.from("ai_conversations")
      .select("id, user_id, project_id, model_id, user_name_snapshot, project_name_snapshot, last_scope_decision, last_policy_status, created_at, updated_at, messages:ai_messages(count)")
      .order("updated_at", { ascending: false })
      .limit(limit + 1);
    if (body.userId) query = query.eq("user_id", requireUuid(body.userId, "User ID"));
    if (body.projectId) query = query.eq("project_id", requireUuid(body.projectId, "Project ID"));
    if (body.modelId) {
      const modelId = requireText(body.modelId, "Model ID", 1, 160);
      if (!findAIModel(modelId)) throw new ApiError(400, "AI_MODEL_UNKNOWN", "지원하지 않는 AI 모델입니다.");
      query = query.eq("model_id", modelId);
    }
    if (body.status) {
      const status = requireText(body.status, "상태", 1, 40);
      if (!POLICY_STATUSES.has(status)) throw new ApiError(400, "AI_LOG_STATUS_INVALID", "AI 기록 상태가 올바르지 않습니다.");
      query = query.eq("last_policy_status", status);
    }
    if (body.from) query = query.gte("created_at", requireText(body.from, "시작 날짜", 10, 40));
    if (body.to) query = query.lte("created_at", requireText(body.to, "종료 날짜", 10, 40));
    const { data, error } = await query;
    if (error) throw new ApiError(500, "AI_CONVERSATIONS_FAILED", "AI 대화 기록을 불러올 수 없습니다.");
    return json(request, { conversations: (data ?? []).slice(0, limit), hasMore: (data?.length ?? 0) > limit });
  }

  if (action === "list_policy_events") {
    const limit = typeof body.limit === "number" && Number.isInteger(body.limit)
      ? Math.min(Math.max(body.limit, 1), 100)
      : 50;
    let query = admin.from("ai_policy_events")
      .select("id, user_id, user_name_snapshot, conversation_id, actor_id, event_type, warning_number, scope_decision, scope_category, scope_reason, scope_confidence, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (body.userId) query = query.eq("user_id", requireUuid(body.userId, "User ID"));
    if (body.from) query = query.gte("created_at", requireText(body.from, "시작 날짜", 10, 40));
    if (body.to) query = query.lte("created_at", requireText(body.to, "종료 날짜", 10, 40));
    const { data, error } = await query;
    if (error) throw new ApiError(500, "AI_POLICY_EVENTS_FAILED", "AI 정책 이력을 불러올 수 없습니다.");
    return json(request, { events: data ?? [] });
  }

  if (action === "get_conversation") {
    const conversationId = requireUuid(body.conversationId, "Conversation ID");
    const [{ data: conversation, error: conversationError }, { data: messages, error: messageError }] = await Promise.all([
      admin.from("ai_conversations")
        .select("id, user_id, project_id, model_id, user_name_snapshot, project_name_snapshot, last_scope_decision, last_policy_status, created_at, updated_at")
        .eq("id", conversationId)
        .maybeSingle(),
      admin.from("ai_messages")
        .select("id, role, content, scope_decision, scope_category, scope_reason, scope_confidence, warning_number, policy_status, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at"),
    ]);
    if (conversationError || messageError) throw new ApiError(500, "AI_CONVERSATION_FAILED", "AI 대화 상세를 불러올 수 없습니다.");
    if (!conversation) throw new ApiError(404, "AI_CONVERSATION_NOT_FOUND", "AI 대화를 찾을 수 없습니다.");
    return json(request, { conversation, messages: messages ?? [] });
  }

  throw new ApiError(400, "AI_LOG_ACTION_INVALID", "지원하지 않는 AI 기록 작업입니다.");
});
