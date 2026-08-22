import { requireReadyUser } from "../_shared/auth.ts";
import { ApiError, json, readJson, serve } from "../_shared/http.ts";
import { requireUuid } from "../_shared/validation.ts";

serve(async (request) => {
  const { user, admin } = await requireReadyUser(request);
  const body = await readJson<{ taskId?: unknown }>(request);
  const taskId = requireUuid(body.taskId, "Task ID");
  const { data: task } = await admin.from("tasks").select("id, project_id").eq("id", taskId).maybeSingle();
  if (!task) throw new ApiError(404, "TASK_NOT_FOUND", "작업을 찾을 수 없습니다.");
  const { data: member } = await admin.from("project_members").select("role").eq("project_id", task.project_id).eq("user_id", user.id).maybeSingle();
  if (!member || !["owner", "admin", "member"].includes(member.role)) throw new ApiError(403, "TASK_PERMISSION_DENIED", "작업을 삭제할 권한이 없습니다.");
  const { data: files, error: listError } = await admin.from("files").select("storage_path").eq("task_id", taskId);
  if (listError) throw new ApiError(500, "STORAGE_CLEANUP_FAILED", "첨부 파일을 확인할 수 없습니다.");
  const paths = (files ?? []).map((file) => file.storage_path);
  if (paths.length) {
    const { error } = await admin.storage.from("project-files").remove(paths);
    if (error) throw new ApiError(500, "STORAGE_CLEANUP_FAILED", "첨부 파일을 정리할 수 없습니다.");
  }
  const { data: deleted, error } = await admin.from("tasks").delete().eq("id", taskId).select("id").maybeSingle();
  if (error || !deleted) throw new ApiError(500, "TASK_DELETE_FAILED", "작업을 삭제할 수 없습니다.");
  return json(request, { deleted: true, projectId: task.project_id });
});
