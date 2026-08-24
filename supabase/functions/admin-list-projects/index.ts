import { requirePermission, requireReadyUser } from "../_shared/auth.ts";
import { ADMIN_PERMISSIONS } from "../_shared/adminPermissions.ts";
import { ApiError, json, serve } from "../_shared/http.ts";

serve(async (request) => {
  const context = await requireReadyUser(request);
  const { admin } = await requirePermission(context, ADMIN_PERMISSIONS.PROJECTS_VIEW);
  const { data, error } = await admin.from("projects").select(
    "id, name, status, visibility, github_repository_name, github_repository_url, github_sync_status, created_at, updated_at, creator:profiles!projects_created_by_fkey(name, student_id), project_members(count), tasks(count)"
  ).order("updated_at", { ascending: false });
  if (error) throw new ApiError(500, "PROJECT_LIST_FAILED", "프로젝트 목록을 불러올 수 없습니다.");
  return json(request, { projects: data ?? [] });
});
