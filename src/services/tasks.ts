import { decryptContent, encryptContent } from "../crypto";
import { supabase } from "../lib/supabase";
import { useAuthStore } from "../stores/authStore";
import { useProjectKeyStore } from "../stores/projectKeyStore";
import type { ChecklistItem, Comment, Task, TaskPriority, TaskStatus } from "../types/domain";

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
    "*, task_assignees(*, profile:profiles!task_assignees_user_id_fkey(id, student_id, name, avatar_url)), task_checklist_items(*), comments(count)"
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

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const user = useAuthStore.getState().user;
  if (!user) throw new Error("로그인이 필요합니다.");
  const key = await projectKey(input.projectId);
  const id = crypto.randomUUID();
  const descriptionEncrypted = input.description
    ? await encryptContent(input.description, key, { projectId: input.projectId, entityType: "task-description", entityId: id })
    : null;
  const { data, error } = await supabase.from("tasks").insert({
    id,
    project_id: input.projectId,
    title: input.title.trim(),
    description_encrypted: descriptionEncrypted,
    status: input.status ?? "todo",
    priority: input.priority ?? "medium",
    progress: input.progress ?? 0,
    start_date: input.startDate || null,
    due_date: input.dueDate || null,
    created_by: user.id
  }).select().single();
  if (error || !data) throw new Error("작업을 생성할 수 없습니다.");
  if (input.assigneeIds?.length) {
    const { error: assigneeError } = await supabase.from("task_assignees").insert(
      [...new Set(input.assigneeIds)].map((userId) => ({ task_id: id, user_id: userId, assigned_by: user.id }))
    );
    if (assigneeError) {
      await supabase.from("tasks").delete().eq("id", id);
      throw new Error("담당자를 지정할 수 없습니다.");
    }
  }
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
