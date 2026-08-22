import { requireReadyUser } from "../_shared/auth.ts";
import { configuredOwner, getRepository, isRepositoryForProject } from "../_shared/github.ts";
import { ApiError, json, readJson, serve } from "../_shared/http.ts";
import { requireUuid } from "../_shared/validation.ts";

serve(async (request) => {
  const { user, admin } = await requireReadyUser(request);
  const body = await readJson<{ projectId?: unknown }>(request);
  const projectId = requireUuid(body.projectId, "Project ID");
  const [{ data: member }, { data: project }] = await Promise.all([
    admin.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle(),
    admin.from("projects").select("id, created_by, github_repository_id, github_repository_name, github_repository_url, github_sync_status").eq("id", projectId).maybeSingle()
  ]);
  if (!project) throw new ApiError(404, "PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
  if (member?.role !== "owner") throw new ApiError(403, "PROJECT_OWNER_REQUIRED", "Project Owner만 Repository 상태를 확인할 수 있습니다.");
  const repository = await getRepository(project.github_repository_name);
  if (!repository) {
    await admin.from("projects").update({ github_repository_id: null, github_repository_url: null, github_owner: null, github_sync_status: "not_connected", github_error_code: null }).eq("id", projectId);
    return json(request, { status: "missing", reconciled: Boolean(project.github_repository_id || project.github_repository_url), repositoryUrl: null });
  }
  if (!isRepositoryForProject(repository, projectId)) return json(request, { status: "conflict", reconciled: false, repositoryUrl: null });
  const needsRecovery = project.github_repository_id !== repository.id || project.github_repository_url !== repository.html_url || project.github_sync_status !== "synced";
  if (needsRecovery) {
    const { data, error } = await admin.rpc("finalize_project_creation", { p_project_id: projectId, p_repository_id: repository.id, p_owner: configuredOwner(), p_repository_name: repository.name, p_repository_url: repository.html_url });
    if (error || !data) throw new ApiError(500, "PROJECT_FINALIZE_FAILED", "Repository 연결 정보를 복구할 수 없습니다.");
    await admin.from("github_sync_jobs").upsert({ project_id: projectId, user_id: project.created_by, action: "create_repository", status: "synced", error_code: null }, { onConflict: "project_id,user_id,action" });
  }
  return json(request, { status: needsRecovery ? "recoverable" : "connected", reconciled: needsRecovery, repositoryUrl: repository.html_url });
});
