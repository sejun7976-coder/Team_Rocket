export type AIConversationRole = "user" | "assistant";
export interface AIConversationMessage {
  role: AIConversationRole;
  content: string;
}

export type ReadonlyAIAction =
  | { type: "list_tasks"; projectId: string }
  | { type: "summarize_project"; projectId: string }
  | { type: "summarize_activity"; projectId: string }
  | { type: "list_project_members"; projectId: string };

export type MutatingAIAction =
  | { type: "create_task"; projectId: string; title: string; description: string; status: "todo" | "in_progress" | "review" | "done"; priority: "low" | "medium" | "high" | "urgent"; dueDate: string | null; assigneeIds: string[] }
  | { type: "update_task"; projectId: string; taskId: string; title?: string; description?: string; priority?: "low" | "medium" | "high" | "urgent"; progress?: number }
  | { type: "change_task_status"; projectId: string; taskId: string; status: "todo" | "in_progress" | "review" | "done" }
  | { type: "assign_task"; projectId: string; taskId: string; assigneeIds: string[] }
  | { type: "set_task_due_date"; projectId: string; taskId: string; dueDate: string | null };

export type AIAction = ReadonlyAIAction | MutatingAIAction;

export interface RocketAIResult {
  message: string;
  actions: AIAction[];
}

export interface AIActionConstraints {
  projectId: string;
  taskIds: ReadonlySet<string>;
  memberIds: ReadonlySet<string>;
  allowMutations: boolean;
}

const STATUSES = new Set(["todo", "in_progress", "review", "done"]);
const PRIORITIES = new Set(["low", "medium", "high", "urgent"]);
const READ_ONLY_TYPES = new Set(["list_tasks", "summarize_project", "summarize_activity", "list_project_members"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, maximum: number, required = false): string | null {
  if (typeof value !== "string") return required ? null : "";
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > maximum) return null;
  return normalized;
}

function date(value: unknown): string | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() + 1 !== month
    || parsed.getUTCDate() !== day
  ) return undefined;
  return value;
}

function assigneeIds(value: unknown, allowed: ReadonlySet<string>): string[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const ids = [...new Set(value.filter((item): item is string => typeof item === "string"))];
  return ids.length === value.length && ids.every((id) => allowed.has(id)) ? ids : null;
}

function parseAction(value: unknown, constraints: AIActionConstraints): AIAction | null {
  const source = record(value);
  const type = source && typeof source.type === "string" ? source.type : "";
  if (!source || !type) return null;
  if (READ_ONLY_TYPES.has(type)) return { type, projectId: constraints.projectId } as ReadonlyAIAction;
  if (!constraints.allowMutations) return null;

  if (type === "create_task") {
    const title = text(source.title, 240, true);
    const description = text(source.description, 4000) ?? null;
    const status = typeof source.status === "string" && STATUSES.has(source.status) ? source.status : "todo";
    const priority = typeof source.priority === "string" && PRIORITIES.has(source.priority) ? source.priority : "medium";
    const dueDate = date(source.dueDate);
    const assigned = assigneeIds(source.assigneeIds ?? [], constraints.memberIds);
    if (!title || description === null || dueDate === undefined || !assigned) return null;
    return {
      type,
      projectId: constraints.projectId,
      title,
      description,
      status: status as "todo" | "in_progress" | "review" | "done",
      priority: priority as "low" | "medium" | "high" | "urgent",
      dueDate,
      assigneeIds: assigned,
    };
  }

  const taskId = typeof source.taskId === "string" && constraints.taskIds.has(source.taskId)
    ? source.taskId
    : null;
  if (!taskId) return null;

  if (type === "change_task_status") {
    if (typeof source.status !== "string" || !STATUSES.has(source.status)) return null;
    return { type, projectId: constraints.projectId, taskId, status: source.status as "todo" | "in_progress" | "review" | "done" };
  }
  if (type === "assign_task") {
    const assigned = assigneeIds(source.assigneeIds, constraints.memberIds);
    return assigned ? { type, projectId: constraints.projectId, taskId, assigneeIds: assigned } : null;
  }
  if (type === "set_task_due_date") {
    const dueDate = date(source.dueDate);
    return dueDate !== undefined ? { type, projectId: constraints.projectId, taskId, dueDate } : null;
  }
  if (type === "update_task") {
    const updates: Omit<Extract<MutatingAIAction, { type: "update_task" }>, "type" | "projectId" | "taskId"> = {};
    if (source.title !== undefined) {
      const title = text(source.title, 240, true);
      if (!title) return null;
      updates.title = title;
    }
    if (source.description !== undefined) {
      const description = text(source.description, 4000);
      if (description === null) return null;
      updates.description = description;
    }
    if (source.priority !== undefined) {
      if (typeof source.priority !== "string" || !PRIORITIES.has(source.priority)) return null;
      updates.priority = source.priority as "low" | "medium" | "high" | "urgent";
    }
    if (source.progress !== undefined) {
      if (!Number.isInteger(source.progress) || Number(source.progress) < 0 || Number(source.progress) > 100) return null;
      updates.progress = Number(source.progress);
    }
    return Object.keys(updates).length
      ? { type, projectId: constraints.projectId, taskId, ...updates }
      : null;
  }
  return null;
}

export function parseRocketAIResult(value: unknown, constraints: AIActionConstraints): RocketAIResult {
  const source = record(value);
  const message = text(source?.message, 12_000, true);
  if (!source || !message || !Array.isArray(source.actions) || source.actions.length > 10) {
    throw new Error("AI_OUTPUT_INVALID");
  }
  const parsedActions = source.actions.map((action) => parseAction(action, constraints));
  if (parsedActions.some((action) => !action)) throw new Error("AI_OUTPUT_INVALID");
  const actions = parsedActions as AIAction[];
  return { message, actions };
}

export function isMutatingAIAction(action: AIAction): action is MutatingAIAction {
  return !READ_ONLY_TYPES.has(action.type);
}

export function userRequestedMutation(message: string): boolean {
  return /(?:생성|추가|만들|수정|변경|배정|할당|마감(?:일)?\s*(?:설정|바꿔)|상태\s*(?:변경|바꿔)|create|add|update|assign|change\s+status|set\s+due)/iu.test(message);
}
