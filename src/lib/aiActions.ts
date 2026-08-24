import {
  isMutatingAIAction,
  type AIAction,
  type MutatingAIAction,
} from "../../supabase/functions/_shared/ai/actionSchema";
import {
  addAssignee,
  createTask,
  removeAssignee,
  updateTask,
} from "../services/tasks";
import type { ProjectMember, Task } from "../types/domain";

export interface AIActionServices {
  createTask: typeof createTask;
  updateTask: typeof updateTask;
  addAssignee: typeof addAssignee;
  removeAssignee: typeof removeAssignee;
}

export interface AIActionExecutionResult {
  action: MutatingAIAction;
  success: boolean;
  error?: string;
}

const defaultServices: AIActionServices = {
  createTask,
  updateTask,
  addAssignee,
  removeAssignee,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "작업을 처리하지 못했습니다.";
}

export function describeAIAction(action: MutatingAIAction, tasks: Task[], members: ProjectMember[]): string {
  const task = "taskId" in action ? tasks.find((item) => item.id === action.taskId) : null;
  const names = "assigneeIds" in action
    ? action.assigneeIds.map((id) => members.find((member) => member.user_id === id)?.profile?.name ?? "알 수 없는 팀원").join(", ")
    : "";
  if (action.type === "create_task") return `작업 생성: ${action.title}${names ? ` · 담당 ${names}` : ""}${action.dueDate ? ` · 마감 ${action.dueDate}` : ""}`;
  if (action.type === "update_task") return `작업 수정: ${task?.title ?? action.taskId}`;
  if (action.type === "change_task_status") return `상태 변경: ${task?.title ?? action.taskId} → ${action.status}`;
  if (action.type === "assign_task") return `담당자 변경: ${task?.title ?? action.taskId} → ${names || "미배정"}`;
  return `마감일 변경: ${task?.title ?? action.taskId} → ${action.dueDate ?? "없음"}`;
}

export async function executeApprovedAIActions(input: {
  projectId: string;
  actions: AIAction[];
  tasks: Task[];
  members: ProjectMember[];
  services?: AIActionServices;
}): Promise<AIActionExecutionResult[]> {
  const services = input.services ?? defaultServices;
  const taskMap = new Map(input.tasks.map((task) => [task.id, { ...task }]));
  const memberIds = new Set(input.members.map((member) => member.user_id));
  const assignments = new Map(input.tasks.map((task) => [
    task.id,
    new Set((task.task_assignees ?? []).map((assignee) => assignee.user_id)),
  ]));
  const results: AIActionExecutionResult[] = [];

  for (const action of input.actions.filter(isMutatingAIAction)) {
    if (action.projectId !== input.projectId) {
      results.push({ action, success: false, error: "다른 프로젝트 Action은 실행할 수 없습니다." });
      continue;
    }
    if ("assigneeIds" in action && action.assigneeIds.some((id) => !memberIds.has(id))) {
      results.push({ action, success: false, error: "담당자는 현재 프로젝트 멤버여야 합니다." });
      continue;
    }
    if ("taskId" in action && !taskMap.has(action.taskId)) {
      results.push({ action, success: false, error: "현재 프로젝트 작업을 찾을 수 없습니다." });
      continue;
    }

    try {
      if (action.type === "create_task") {
        const created = await services.createTask({
          projectId: input.projectId,
          title: action.title,
          description: action.description,
          status: action.status,
          priority: action.priority,
          ...(action.dueDate ? { dueDate: action.dueDate } : {}),
          assigneeIds: action.assigneeIds,
        });
        taskMap.set(created.id, created);
      } else if (action.type === "assign_task") {
        const previous = assignments.get(action.taskId) ?? new Set<string>();
        const next = new Set(action.assigneeIds);
        for (const userId of previous) if (!next.has(userId)) await services.removeAssignee(action.taskId, userId);
        for (const userId of next) if (!previous.has(userId)) await services.addAssignee(action.taskId, userId);
        assignments.set(action.taskId, next);
      } else {
        const task = taskMap.get(action.taskId)!;
        const updates = action.type === "change_task_status"
          ? { status: action.status }
          : action.type === "set_task_due_date"
            ? { due_date: action.dueDate }
            : {
                ...(action.title !== undefined ? { title: action.title } : {}),
                ...(action.description !== undefined ? { description: action.description } : {}),
                ...(action.priority !== undefined ? { priority: action.priority } : {}),
                ...(action.progress !== undefined ? { progress: action.progress } : {}),
              };
        await services.updateTask(task, updates);
        taskMap.set(action.taskId, { ...task, ...updates, revision: task.revision + 1 });
      }
      results.push({ action, success: true });
    } catch (error) {
      results.push({ action, success: false, error: errorMessage(error) });
    }
  }
  return results;
}
