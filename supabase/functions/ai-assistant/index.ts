import { requireReadyUser } from "../_shared/auth.ts";
import { decryptGatewayKey, loadAIGateway, loadAIModel } from "../_shared/ai/configuration.ts";
import { callAIGateway } from "../_shared/ai/gateway.ts";
import { detectIntent, rocketAIJsonSchema, type AIIntent } from "../_shared/ai/schema.ts";
import { listRecentCommits } from "../_shared/github.ts";
import { ApiError, json, readJson, serve } from "../_shared/http.ts";
import { requireText, requireUuid } from "../_shared/validation.ts";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function optionalText(value: unknown, maximum: number): string | null {
  return typeof value === "string" ? value.slice(0, maximum) : null;
}

function sanitizeProjectContext(value: unknown): Record<string, unknown> {
  const context = record(value);
  const project = record(context.project);
  const members = Array.isArray(context.members) ? context.members.slice(0, 100).map((item) => {
    const member = record(item);
    return { id: optionalText(member.id, 36), name: optionalText(member.name, 80), studentId: optionalText(member.studentId, 12) };
  }) : [];
  const tasks = Array.isArray(context.tasks) ? context.tasks.slice(0, 100).map((item) => {
    const task = record(item);
    return {
      id: optionalText(task.id, 36),
      title: optionalText(task.title, 240),
      description: optionalText(task.description, 6000),
      status: optionalText(task.status, 30),
      priority: optionalText(task.priority, 30),
      dueDate: optionalText(task.dueDate, 30),
      progress: typeof task.progress === "number" && Number.isFinite(task.progress) ? task.progress : null,
      assigneeIds: Array.isArray(task.assigneeIds) ? task.assigneeIds.filter((id): id is string => typeof id === "string").slice(0, 50) : []
    };
  }) : [];
  const activities = Array.isArray(context.activities) ? context.activities.slice(0, 50).map((item) => {
    const activity = record(item);
    return {
      action: optionalText(activity.action, 80),
      subjectType: optionalText(activity.subjectType, 40),
      actorId: optionalText(activity.actorId, 36),
      createdAt: optionalText(activity.createdAt, 40)
    };
  }) : [];
  const files = Array.isArray(context.files) ? context.files.slice(0, 50).map((item) => {
    const file = record(item);
    return {
      name: optionalText(file.name, 240),
      contentType: optionalText(file.contentType, 120),
      sizeBytes: typeof file.sizeBytes === "number" && Number.isFinite(file.sizeBytes) ? file.sizeBytes : null,
      taskId: optionalText(file.taskId, 36),
      createdAt: optionalText(file.createdAt, 40)
    };
  }) : [];
  return {
    project: context.project ? { name: optionalText(project.name, 200), status: optionalText(project.status, 30) } : null,
    members,
    tasks,
    activities,
    files
  };
}

serve(async (request) => {
  const { user, admin } = await requireReadyUser(request);
  const body = await readJson<{ projectId?: unknown; modelSettingId?: unknown; messages?: unknown; context?: unknown }>(request, 262_144);
  const projectId = requireUuid(body.projectId, "Project ID");
  const modelSettingId = requireUuid(body.modelSettingId, "Model setting ID");
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 20) throw new ApiError(400, "AI_MESSAGES_INVALID", "최근 대화는 1~20개여야 합니다.");
  const messages = body.messages.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new ApiError(400, "AI_MESSAGES_INVALID", "대화 형식이 올바르지 않습니다.");
    const record = item as Record<string, unknown>;
    if (!["user", "assistant"].includes(String(record.role))) throw new ApiError(400, "AI_MESSAGES_INVALID", "대화 역할이 올바르지 않습니다.");
    return { role: record.role, content: requireText(record.content, "대화", 1, 6000) };
  });
  if (!body.context || typeof body.context !== "object" || Array.isArray(body.context)) throw new ApiError(400, "AI_CONTEXT_INVALID", "AI context가 올바르지 않습니다.");
  const projectContext = sanitizeProjectContext(body.context);
  const { data: membership } = await admin.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle();
  if (!membership) throw new ApiError(403, "PROJECT_ACCESS_DENIED", "프로젝트 멤버만 Rocket AI를 사용할 수 있습니다.");
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await admin.from("ai_usage_logs").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
  if ((count ?? 0) >= 10) throw new ApiError(429, "AI_RATE_LIMIT", "잠시 후 다시 시도해 주세요.");

  const model = await loadAIModel(admin, modelSettingId);
  if (!model?.enabled) throw new ApiError(409, "AI_MODEL_UNAVAILABLE", "선택한 AI 모델을 사용할 수 없습니다.");
  const gateway = await loadAIGateway(admin);
  if (!gateway?.enabled) throw new ApiError(409, "AI_DISABLED", "Rocket AI가 비활성화되어 있습니다.");
  if (!gateway.base_url || !gateway.api_key_ciphertext || !gateway.api_key_iv) throw new ApiError(409, "AI_NOT_CONFIGURED", "AI Gateway가 설정되지 않았습니다.");

  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  let intent: AIIntent = detectIntent(lastUserMessage);
  let githubActivity: Array<{ sha: string; message: string; authoredAt: string | null; author: string | null }> = [];
  if (["github_summary", "project_summary", "weekly_report"].includes(intent)) {
    const { data: project } = await admin.from("projects").select("github_repository_name, github_repository_url").eq("id", projectId).single();
    if (project?.github_repository_url) {
      try {
        githubActivity = await listRecentCommits(project.github_repository_name);
      } catch {
        // GitHub is an optional integration. AI project assistance remains available.
        githubActivity = [];
      }
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  const started = Date.now();
  let success = false;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  try {
    const prompt = JSON.stringify({ intentHint: intent, messages, context: { ...projectContext, currentUserId: user.id }, githubActivity, today: new Date().toISOString().slice(0, 10) });
    const response = await callAIGateway({
      baseUrl: gateway.base_url,
      apiKey: await decryptGatewayKey(gateway.api_key_ciphertext, gateway.api_key_iv),
      model: model.model_id,
      system: `You are Rocket AI, a Korean project-management assistant for Team Rocket. Infer the user's intent from chat, using one of: chat, create_task, split_task, project_briefing, project_summary, weekly_report, project_qa, github_summary. For briefings prioritize the current user's due dates, overdue tasks, priority and status. For weekly reports organize completed work, work in progress, issues and next-week plans using tasks, activity, file metadata and recent commits. File context contains metadata only, never document contents. Never claim that you changed data. For mutations return task proposals only until the user confirms in the browser. Use only supplied context and member UUIDs. Return only JSON matching this schema: ${JSON.stringify(rocketAIJsonSchema)}`,
      prompt,
      signal: controller.signal
    });
    intent = response.result.intent;
    success = true;
    inputTokens = response.inputTokens;
    outputTokens = response.outputTokens;
    return json(request, { ...response.result, model: { id: model.id, family: model.family, displayName: model.display_name } });
  } finally {
    clearTimeout(timeout);
    await admin.from("ai_usage_logs").insert({ user_id: user.id, project_id: projectId, feature: intent, provider: "gateway", model: model.model_id, success, latency_ms: Date.now() - started, input_tokens: inputTokens, output_tokens: outputTokens });
  }
});
