import { requireReadyUser } from "../_shared/auth.ts";
import { ApiError, json, readJson, serve } from "../_shared/http.ts";
import { requireUuid } from "../_shared/validation.ts";

function databaseError(code: string | undefined, fallback: "TASK_DELETE_CONFLICT" | "TASK_DELETE_DB_FAILED"): ApiError {
  console.error(JSON.stringify({ event: "task_delete_database_error", postgresCode: typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : "UNKNOWN" }));
  if (code === "42703") return new ApiError(500, "TASK_SCHEMA_ERROR", "작업 데이터 구조를 확인할 수 없습니다.");
  if (code === "23503" || code === "40001" || code === "40P01") return new ApiError(409, "TASK_DELETE_CONFLICT", "연결된 작업 데이터 정리가 충돌했습니다. 다시 시도해 주세요.");
  return new ApiError(500, fallback, "작업 데이터를 삭제할 수 없습니다.");
}

function isStorageNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  return record.status === 404 || record.statusCode === "404" || record.code === "404"
    || record.error === "not_found" || record.statusCode === "NoSuchKey";
}

serve(async (request) => {
  const { user, admin } = await requireReadyUser(request);
  const body = await readJson<{ taskId?: unknown }>(request);
  const taskId = requireUuid(body.taskId, "Task ID");
  const { data: task, error: taskError } = await admin.from("tasks").select("id, project_id, created_by").eq("id", taskId).maybeSingle();
  if (taskError) throw databaseError(taskError.code, "TASK_DELETE_DB_FAILED");
  if (!task) throw new ApiError(404, "TASK_NOT_FOUND", "작업을 찾을 수 없습니다.");
  const { data: member, error: memberError } = await admin.from("project_members").select("role").eq("project_id", task.project_id).eq("user_id", user.id).maybeSingle();
  if (memberError) throw databaseError(memberError.code, "TASK_DELETE_DB_FAILED");
  const allowed = member && (["owner", "admin"].includes(member.role) || task.created_by === user.id);
  if (!allowed) throw new ApiError(403, "TASK_DELETE_FORBIDDEN", "작업을 삭제할 권한이 없습니다.");

  const { data: files, error: listError } = await admin.from("files").select("storage_path").eq("task_id", taskId);
  if (listError) throw databaseError(listError.code, "TASK_DELETE_DB_FAILED");
  const paths = [...new Set((files ?? []).map((file) => file.storage_path).filter((path): path is string => typeof path === "string" && path.length > 0))];
  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await admin.storage.from("project-files").remove(paths.slice(index, index + 100));
    if (error && !isStorageNotFound(error)) throw new ApiError(502, "TASK_STORAGE_CLEANUP_FAILED", "첨부 파일을 정리할 수 없습니다. 작업은 보존되었습니다.");
  }

  const { data: deleted, error: deleteError } = await admin.from("tasks").delete().eq("id", taskId).select("id").maybeSingle();
  if (deleteError) throw databaseError(deleteError.code, "TASK_DELETE_DB_FAILED");
  if (!deleted) throw new ApiError(409, "TASK_DELETE_CONFLICT", "작업이 이미 변경되었거나 삭제되었습니다.");
  console.info(JSON.stringify({ event: "task_deleted", userId: user.id, projectId: task.project_id, taskId, fileCount: paths.length }));
  return json(request, { deleted: true, projectId: task.project_id });
});
