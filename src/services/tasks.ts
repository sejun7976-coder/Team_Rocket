import { decryptContent, encryptContent } from "../crypto";
import { supabase } from "../lib/supabase";
import { useAuthStore } from "../stores/authStore";
import { useProjectKeyStore } from "../stores/projectKeyStore";
import type { ChecklistItem, Comment, Task, TaskPriority, TaskStatus } from "../types/domain";
import { AuthenticatedFunctionError, invokeAuthenticatedFunction } from "../lib/authenticatedFunction";

async function projectKey(projectId: string): Promise<CryptoKey> {
  return useProjectKeyStore.getState().unlock(projectId);
}

async function decryptTask(task: Task, key: CryptoKey): Promise<Task> {
  const description = task.description_encrypted
    ? await decryptContent<string>(task.description_encrypted, key, { projectId: task.project_id, entityType: "task-description", entityId: task.id })
    : "";
  const checklist = await Promise.all((task.task_checklist_items ?? []).map(async (item) => ({
    ...item,
    content: await decryptContent<string>(item.content_encrypted, key, {
      projectId: task.project_id,
      entityType: "checklist",
      entityId: item.id
    })
  })));
  return { ...task, description, task_checklist_items: checklist };
}

export async function listTasks(projectId: string): Promise<Task[]> {
  const key = await projectKey(projectId);
  const { data, error } = await supabase.from("tasks").select(
    "*, task_assignees(*, profile:profiles!task_assignees_user_id_fkey(id, student_id, name, avatar_url)), task_checklist_items(*), comments(count), files(count)"
  ).eq("project_id", projectId).is("deleted_at", null).order("updated_at", { ascending: false });
  if (error) throw new Error("작업 목록을 불러올 수 없습니다.");
  return Promise.all(((data ?? []) as unknown as Task[]).map((task) => decryptTask(task, key)));
}

export async function getTask(taskId: string): Promise<Task> {
  const { data: metadata, error } = await supabase.from("tasks").select("project_id").eq("id", taskId).is("deleted_at", null).single();
  if (error || !metadata) throw new Error("작업을 찾을 수 없거나 접근 권한이 없습니다.");
  const tasks = await listTasks(metadata.project_id as string);
  const task = tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("작업을 찾을 수 없습니다.");
  return task;
}

export interface CreateTaskInput {
  projectId: string;
  title: string;
  description?: string | undefined;
  status?: TaskStatus | undefined;
  priority?: TaskPriority | undefined;
  progress?: number | undefined;
  startDate?: string | undefined;
  dueDate?: string | undefined;
  assigneeIds?: string[] | undefined;
}

export type TaskServiceErrorCode = "TASK_PERMISSION_DENIED" | "INVALID_ASSIGNEE" | "TASK_INPUT_INVALID" | "TASK_RPC_NOT_AVAILABLE" | "TASK_SCHEMA_ERROR" | "TASK_CREATE_FAILED" | "PROJECT_KEY_LOCKED" | "TASK_NOT_FOUND" | "TASK_DELETE_FORBIDDEN" | "TASK_STORAGE_CLEANUP_FAILED" | "TASK_DELETE_CONFLICT" | "TASK_DELETE_DB_FAILED";
export class TaskServiceError extends Error {
  constructor(public readonly code: TaskServiceErrorCode, message: string, public readonly databaseCode?: string) {
    super(message);
    this.name = "TaskServiceError";
  }
}

function taskRpcError(error: { code?: string; message?: string } | null): TaskServiceError {
  const code = error?.code;
  const message = error?.message ?? "";
  if (code === "RT401" || code === "RT403" || code === "42501" || message.includes("TASK_PERMISSION_DENIED")) {
    return new TaskServiceError("TASK_PERMISSION_DENIED", "이 프로젝트에서 작업을 생성할 권한이 없습니다.");
  }
  if (code === "RT422" || code === "23503" || message.includes("INVALID_ASSIGNEE")) {
    return new TaskServiceError("INVALID_ASSIGNEE", "담당자는 현재 프로젝트 멤버여야 합니다.");
  }
  if (code === "RT400" || code === "22000" || code === "22007" || code === "22P02" || message.includes("TASK_INPUT_INVALID")) {
    return new TaskServiceError("TASK_INPUT_INVALID", "작업 입력값을 확인해 주세요.");
  }
  if (code === "PGRST202" || code === "42883") return new TaskServiceError("TASK_RPC_NOT_AVAILABLE", "작업 생성 RPC가 API schema cache에 없습니다. migration 009 적용 상태를 확인해 주세요. (TASK_RPC_NOT_AVAILABLE)", code);
  if (code === "42703") return new TaskServiceError("TASK_SCHEMA_ERROR", "작업 저장 과정의 서버 데이터 구조가 올바르지 않습니다. (TASK_SCHEMA_ERROR)", code);
  const safeCode = code && /^[A-Z0-9]{2,12}$/u.test(code) ? code : "UNKNOWN";
  return new TaskServiceError("TASK_CREATE_FAILED", `작업을 생성할 수 없습니다. (TASK_CREATE_FAILED/${safeCode})`, safeCode);
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const user = useAuthStore.getState().user;
  if (!user) throw new Error("로그인이 필요합니다.");
  let key: CryptoKey;
  try { key = await projectKey(input.projectId); }
  catch { throw new TaskServiceError("PROJECT_KEY_LOCKED", "프로젝트 키가 잠겨 있습니다. 다시 잠금을 해제해 주세요."); }
  const id = crypto.randomUUID();
  const descriptionEncrypted = input.description
    ? await encryptContent(input.description, key, { projectId: input.projectId, entityType: "task-description", entityId: id })
    : null;
  const { data, error } = await supabase.rpc("create_task_atomic", {
    p_task_id: id,
    p_project_id: input.projectId,
    p_title: input.title.trim(),
    p_description_encrypted: descriptionEncrypted,
    p_status: input.status ?? "todo",
    p_priority: input.priority ?? "medium",
    p_progress: input.progress ?? 0,
    p_start_date: input.startDate?.trim() || null,
    p_due_date: input.dueDate?.trim() || null,
    p_assignee_ids: [...new Set(input.assigneeIds ?? [])]
  });
  if (error || !data) throw taskRpcError(error);
  return { ...(data as Task), description: input.description ?? "" };
}

export async function updateTask(
  task: Task,
  updates: Partial<Pick<Task, "title" | "status" | "priority" | "progress" | "progress_mode" | "start_date" | "due_date">> & { description?: string }
): Promise<void> {
  const payload: Record<string, unknown> = { ...updates, revision: task.revision + 1 };
  delete payload.description;
  if (updates.description !== undefined) {
    const key = await projectKey(task.project_id);
    payload.description_encrypted = updates.description
      ? await encryptContent(updates.description, key, { projectId: task.project_id, entityType: "task-description", entityId: task.id })
      : null;
  }
  const { data, error } = await supabase.from("tasks").update(payload).eq("id", task.id).eq("revision", task.revision).select("id").maybeSingle();
  if (error) throw new Error("작업을 수정할 수 없습니다.");
  if (!data) throw new Error("다른 사용자가 먼저 수정했습니다. 최신 내용을 다시 불러오세요.");
}

export async function addAssignee(taskId: string, userId: string): Promise<void> {
  const currentUser = useAuthStore.getState().user;
  if (!currentUser) throw new Error("로그인이 필요합니다.");
  const { error } = await supabase.from("task_assignees").upsert({ task_id: taskId, user_id: userId, assigned_by: currentUser.id }, { onConflict: "task_id,user_id", ignoreDuplicates: true });
  if (error) throw new Error("프로젝트 멤버만 담당자로 추가할 수 있습니다.");
}

export async function removeAssignee(taskId: string, userId: string): Promise<void> {
  const { error } = await supabase.from("task_assignees").delete().eq("task_id", taskId).eq("user_id", userId);
  if (error) throw new Error("담당자를 제거할 수 없습니다.");
}

export async function deleteTask(taskId: string): Promise<{ projectId: string }> {
  try {
    return await invokeAuthenticatedFunction("delete-task", { body: { taskId }, fallbackMessage: "작업을 삭제할 수 없습니다." });
  } catch (error) {
    if (!(error instanceof AuthenticatedFunctionError)) throw error;
    const messages: Record<string, string> = {
      TASK_NOT_FOUND: "작업을 찾을 수 없습니다.",
      TASK_DELETE_FORBIDDEN: "작업을 삭제할 권한이 없습니다.",
      TASK_STORAGE_CLEANUP_FAILED: "첨부 파일을 정리하지 못해 작업을 보존했습니다. 다시 시도해 주세요.",
      TASK_DELETE_CONFLICT: "연결된 작업 데이터 정리가 충돌했습니다. 다시 시도해 주세요.",
      TASK_DELETE_DB_FAILED: "작업 데이터를 삭제할 수 없습니다.",
      TASK_SCHEMA_ERROR: "작업 데이터 구조가 올바르지 않습니다."
    };
    const code = error.code in messages ? error.code as TaskServiceErrorCode : "TASK_DELETE_DB_FAILED";
    throw new TaskServiceError(code, `${messages[code] ?? messages.TASK_DELETE_DB_FAILED} (${code})`);
  }
}

export async function addChecklistItem(task: Task, content: string, position: number): Promise<void> {
  const user = useAuthStore.getState().user;
  if (!user) throw new Error("로그인이 필요합니다.");
  const id = crypto.randomUUID();
  const key = await projectKey(task.project_id);
  const encrypted = await encryptContent(content, key, { projectId: task.project_id, entityType: "checklist", entityId: id });
  const { error } = await supabase.from("task_checklist_items").insert({ id, task_id: task.id, content_encrypted: encrypted, position, created_by: user.id });
  if (error) throw new Error("체크리스트를 추가할 수 없습니다.");
}

export async function updateChecklistItem(item: ChecklistItem, completed: boolean): Promise<void> {
  const { error } = await supabase.from("task_checklist_items").update({ completed }).eq("id", item.id);
  if (error) throw new Error("체크리스트를 수정할 수 없습니다.");
}

export async function listComments(task: Task): Promise<Comment[]> {
  const key = await projectKey(task.project_id);
  const { data, error } = await supabase.from("comments").select(
    "*, author:profiles!comments_author_id_fkey(id, name, student_id, avatar_url)"
  ).eq("task_id", task.id).is("deleted_at", null).order("created_at");
  if (error) throw new Error("댓글을 불러올 수 없습니다.");
  return Promise.all(((data ?? []) as unknown as Comment[]).map(async (comment) => ({
    ...comment,
    content: await decryptContent<string>(comment.content_encrypted, key, {
      projectId: task.project_id,
      entityType: "comment",
      entityId: comment.id
    })
  })));
}

export async function createComment(task: Task, content: string): Promise<void> {
  const user = useAuthStore.getState().user;
  if (!user) throw new Error("로그인이 필요합니다.");
  const id = crypto.randomUUID();
  const key = await projectKey(task.project_id);
  const encrypted = await encryptContent(content, key, { projectId: task.project_id, entityType: "comment", entityId: id });
  const { error } = await supabase.from("comments").insert({ id, task_id: task.id, author_id: user.id, content_encrypted: encrypted });
  if (error) throw new Error("댓글을 작성할 수 없습니다.");
  const mentions = [...new Set([...content.matchAll(/@([0-9]{6,12})/gu)].map((match) => match[1]).filter((value): value is string => Boolean(value)))];
  if (mentions.length) await supabase.rpc("notify_mentions", { p_task_id: task.id, p_student_ids: mentions });
}

export async function updateComment(task: Task, comment: Comment, content: string): Promise<void> {
  const key = await projectKey(task.project_id);
  const encrypted = await encryptContent(content, key, { projectId: task.project_id, entityType: "comment", entityId: comment.id });
  const { error } = await supabase.from("comments").update({ content_encrypted: encrypted, revision: comment.revision + 1 })
    .eq("id", comment.id).eq("revision", comment.revision);
  if (error) throw new Error("댓글을 수정할 수 없습니다.");
}

export async function deleteComment(commentId: string): Promise<void> {
  const { error } = await supabase.from("comments").update({ deleted_at: new Date().toISOString() }).eq("id", commentId);
  if (error) throw new Error("댓글을 삭제할 수 없습니다.");
}
