import { invokeAuthenticatedFunction } from "../lib/authenticatedFunction";
import {
  parseRocketAIResult,
  userRequestedMutation,
  type AIConversationMessage,
  type RocketAIResult,
} from "../../supabase/functions/_shared/ai/actionSchema";

export interface AIModelChoice {
  modelId: string;
  displayName: string;
  family: string;
  isDefault: boolean;
}

export interface AIModelSetting extends AIModelChoice {
  enabled: boolean;
  sortOrder: number;
}

export interface AISettings {
  gateway: { configured: boolean };
  guardModelId: string | null;
  models: AIModelSetting[];
}

export type AIScopeDecision = "ALLOW" | "UNCERTAIN" | "VIOLATION" | "BYPASS";

export interface AIChatPolicy {
  decision: AIScopeDecision;
  category: string;
  confidence: number;
  reason: string;
  warningCount: number;
  suspended: boolean;
}

export interface AIChatResult extends RocketAIResult {
  conversationId: string;
  policy?: AIChatPolicy;
  model?: { modelId: string; displayName: string };
}

export interface AIProjectContext {
  project: { name: string; description: string; announcement: string };
  members: Array<{ id: string; name: string }>;
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    dueDate: string | null;
    assigneeIds: string[];
  }>;
  activities: Array<{ actor: string; action: string; subjectType: string; occurredAt: string }>;
}

export async function listAIModels(): Promise<AIModelChoice[]> {
  const data = await invokeAuthenticatedFunction<{ models: AIModelChoice[] }>("ai-models", {
    body: {},
    fallbackMessage: "AI 모델 목록을 불러올 수 없습니다.",
  });
  return data.models;
}

export async function requestRocketAI(input: {
  projectId: string;
  modelId: string;
  conversationId?: string;
  messages: AIConversationMessage[];
  context: AIProjectContext;
}): Promise<AIChatResult> {
  const data = await invokeAuthenticatedFunction<Record<string, unknown>>("ai-chat", {
    body: input,
    fallbackMessage: "AI 응답을 받아오지 못했습니다.",
  });
  const result = parseRocketAIResult(data, {
    projectId: input.projectId,
    taskIds: new Set(input.context.tasks.map((task) => task.id)),
    memberIds: new Set(input.context.members.map((member) => member.id)),
    allowMutations: userRequestedMutation(input.messages.at(-1)?.content ?? ""),
  });
  const conversationId = typeof data.conversationId === "string" ? data.conversationId : "";
  if (!conversationId) throw new Error("AI 대화 식별 정보가 올바르지 않습니다.");
  const model = data.model && typeof data.model === "object"
    ? data.model as Record<string, unknown>
    : {};
  const policy = data.policy && typeof data.policy === "object"
    ? data.policy as AIChatPolicy
    : undefined;
  const safeModel = typeof model.modelId === "string" && typeof model.displayName === "string"
    ? { modelId: model.modelId, displayName: model.displayName }
    : undefined;
  return { ...result, conversationId, ...(policy ? { policy } : {}), ...(safeModel ? { model: safeModel } : {}) };
}

export async function getAISettings(): Promise<AISettings> {
  return invokeAuthenticatedFunction("admin-ai-settings", {
    body: { action: "get" },
    fallbackMessage: "AI 설정을 불러올 수 없습니다.",
  });
}

export async function setAIModelState(input: {
  modelId: string;
  enabled: boolean;
  makeDefault: boolean;
}): Promise<AISettings> {
  return invokeAuthenticatedFunction("admin-ai-settings", {
    body: { action: "set_model", ...input },
    fallbackMessage: "AI 모델 설정을 변경하지 못했습니다.",
  });
}

export async function setAIGuardModel(modelId: string): Promise<AISettings> {
  return invokeAuthenticatedFunction("admin-ai-settings", {
    body: { action: "set_guard_model", modelId },
    fallbackMessage: "Guard Model을 변경하지 못했습니다.",
  });
}

export async function resetAIUserPolicy(userId: string): Promise<void> {
  await invokeAuthenticatedFunction("admin-ai-settings", {
    body: { action: "reset_user_policy", userId },
    fallbackMessage: "AI 사용 제한을 해제하지 못했습니다.",
  });
}

export async function testAIConnection(): Promise<void> {
  await invokeAuthenticatedFunction("admin-ai-settings", {
    body: { action: "test" },
    fallbackMessage: "AI Gateway에 연결하지 못했습니다.",
  });
}

export interface AIManagedUser {
  id: string;
  student_id: string;
  name: string;
  system_role: "user" | "admin";
  account_status: string;
  warningCount: number;
  suspended: boolean;
  suspendedAt: string | null;
  suspensionReason: string | null;
  lastWarningAt: string | null;
  lastAiUsedAt: string | null;
}

export interface AIConversationSummary {
  id: string;
  user_id: string | null;
  project_id: string | null;
  model_id: string;
  user_name_snapshot: string;
  project_name_snapshot: string;
  last_scope_decision: AIScopeDecision | null;
  last_policy_status: string;
  created_at: string;
  updated_at: string;
  messages: Array<{ count: number }>;
}

export interface AIConversationMessageLog {
  id: string;
  role: "user" | "assistant";
  content: string;
  scope_decision: AIScopeDecision | null;
  scope_category: string | null;
  scope_reason: string | null;
  scope_confidence: number | null;
  warning_number: number | null;
  policy_status: string;
  created_at: string;
}

async function invokeAILogs<T>(body: Record<string, unknown>): Promise<T> {
  return invokeAuthenticatedFunction("admin-ai-logs", {
    body,
    fallbackMessage: "AI 대화 기록을 불러올 수 없습니다.",
  });
}

export async function listAIManagedUsers(): Promise<AIManagedUser[]> {
  const data = await invokeAILogs<{ users: AIManagedUser[] }>({ action: "list_users" });
  return data.users;
}

export async function listAIManagedUsersForManagement(): Promise<AIManagedUser[]> {
  const data = await invokeAuthenticatedFunction<{ users: AIManagedUser[] }>("admin-ai-settings", {
    body: { action: "list_users" },
    fallbackMessage: "AI 사용자 상태를 불러올 수 없습니다.",
  });
  return data.users;
}

export interface AIPolicyEvent {
  id: string;
  user_id: string | null;
  user_name_snapshot: string;
  conversation_id: string | null;
  actor_id: string | null;
  event_type: "warning" | "suspension" | "reset" | "output_blocked" | "project_data_injection";
  warning_number: number | null;
  scope_decision: AIScopeDecision | null;
  scope_category: string | null;
  scope_reason: string | null;
  scope_confidence: number | null;
  created_at: string;
}

export async function listAIPolicyEvents(filters: {
  userId?: string;
  from?: string;
  to?: string;
}): Promise<AIPolicyEvent[]> {
  const data = await invokeAILogs<{ events: AIPolicyEvent[] }>({
    action: "list_policy_events",
    ...filters,
  });
  return data.events;
}

export async function getAIConversationFilters(): Promise<{
  users: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
  models: string[];
  statuses: string[];
}> {
  return invokeAILogs({ action: "filters" });
}

export async function listAIConversations(filters: {
  userId?: string;
  projectId?: string;
  modelId?: string;
  status?: string;
  from?: string;
  to?: string;
}): Promise<{ conversations: AIConversationSummary[]; hasMore: boolean }> {
  return invokeAILogs({ action: "list_conversations", ...filters });
}

export async function getAIConversation(conversationId: string): Promise<{
  conversation: Omit<AIConversationSummary, "messages">;
  messages: AIConversationMessageLog[];
}> {
  return invokeAILogs({ action: "get_conversation", conversationId });
}
