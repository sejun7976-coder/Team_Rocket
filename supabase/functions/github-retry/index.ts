import { requireReadyUser } from "../_shared/auth.ts";
import {
  addCollaborator,
  configuredOwner,
  ensureProjectRepository,
  removeCollaborator,
  verifyConfiguredOwner
} from "../_shared/github.ts";
import { ApiError, json, readJson, serve } from "../_shared/http.ts";
import { requireText, requireUuid } from "../_shared/validation.ts";

type RetryAction = "create_repository" | "add_collaborator" | "remove_collaborator";

serve(async (request) => {
  const { user, admin } = await requireReadyUser(request);
  const body = await readJson<{ projectId?: unknown; userId?: unknown; action?: unknown }>(request);
  const projectId = requireUuid(body.projectId, "Project ID");
  const rawAction = requireText(body.action, "동기화 작업", 1, 40);
  if (!["create_repository", "add_collaborator", "remove_collaborator"].includes(rawAction)) {
    throw new ApiError(400, "INVALID_ACTION", "지원하지 않는 동기화 작업입니다.");
  }
  const action = rawAction as RetryAction;

  const [{ data: actor }, { data: project }] = await Promise.all([
    admin.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).single(),
    admin.from("projects").select("id, created_by, description, visibility, github_repository_name").eq("id", projectId).single()
  ]);
  if (!actor || (action === "create_repository" ? actor.role !== "owner" : !["owner", "admin"].includes(actor.role))) {
    throw new ApiError(403, action === "create_repository" ? "PROJECT_OWNER_REQUIRED" : "ADMIN_REQUIRED", "동기화를 재시도할 권한이 없습니다.");
  }
  if (!project) throw new ApiError(404, "PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.");

  if (action === "create_repository") {
    const { data: previous } = await admin.from("github_sync_jobs").select("attempts")
      .eq("project_id", projectId).eq("user_id", project.created_by).eq("action", action).maybeSingle();
    const attempts = (previous?.attempts ?? 0) + 1;
    await admin.from("github_sync_jobs").upsert({
      project_id: projectId,
      user_id: project.created_by,
      action,
      status: "pending",
      error_code: null,
      attempts
    }, { onConflict: "project_id,user_id,action" });
    try {
      await verifyConfiguredOwner();
      const repository = await ensureProjectRepository({
        projectId,
        name: project.github_repository_name,
        description: project.description ?? undefined,
        visibility: project.visibility === "public" ? "public" : "private"
      });
      const { data: finalized, error } = await admin.rpc("finalize_project_creation", {
        p_project_id: projectId,
        p_repository_id: repository.id,
        p_owner: configuredOwner(),
        p_repository_name: repository.name,
        p_repository_url: repository.html_url
      });
      if (error || !finalized) throw new ApiError(500, "PROJECT_FINALIZE_FAILED", "GitHub Repository 연결을 저장할 수 없습니다.");
      await admin.from("github_sync_jobs").upsert({
        project_id: projectId,
        user_id: project.created_by,
        action,
        status: "synced",
        error_code: null,
        attempts
      }, { onConflict: "project_id,user_id,action" });
      console.info(JSON.stringify({ event: "github_repository_recovered", userId: user.id, projectId, repositoryId: repository.id }));
      return json(request, { synced: true, project: finalized });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "GITHUB_API_FAILED";
      await Promise.allSettled([
        admin.from("github_sync_jobs").upsert({
          project_id: projectId,
          user_id: project.created_by,
          action,
          status: "error",
          error_code: code,
          attempts
        }, { onConflict: "project_id,user_id,action" }),
        admin.rpc("mark_project_creation_error", { p_project_id: projectId, p_error_code: code })
      ]);
      throw error;
    }
  }

  const targetUserId = requireUuid(body.userId, "User ID");
  const { data: profile } = await admin.from("profiles").select("github_username").eq("id", targetUserId).single();
  if (!profile?.github_username) throw new ApiError(409, "GITHUB_NOT_CONNECTED", "대상 사용자의 GitHub 계정이 연결되지 않았습니다.");

  const { data: previous } = await admin.from("github_sync_jobs").select("attempts")
    .eq("project_id", projectId).eq("user_id", targetUserId).eq("action", action).maybeSingle();
  const attempts = (previous?.attempts ?? 0) + 1;
  try {
    if (action === "add_collaborator") await addCollaborator(project.github_repository_name, profile.github_username);
    else await removeCollaborator(project.github_repository_name, profile.github_username);
    await admin.from("github_sync_jobs").upsert({
      project_id: projectId,
      user_id: targetUserId,
      action,
      status: "synced",
      error_code: null,
      attempts
    }, { onConflict: "project_id,user_id,action" });
    if (action === "add_collaborator") {
      await admin.from("project_members").update({ github_sync_status: "synced", github_error_code: null })
        .eq("project_id", projectId).eq("user_id", targetUserId);
    }
    return json(request, { synced: true });
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "GITHUB_API_FAILED";
    await admin.from("github_sync_jobs").upsert({
      project_id: projectId,
      user_id: targetUserId,
      action,
      status: "error",
      error_code: code,
      attempts
    }, { onConflict: "project_id,user_id,action" });
    if (action === "add_collaborator") {
      await admin.from("project_members").update({ github_sync_status: "error", github_error_code: code })
        .eq("project_id", projectId).eq("user_id", targetUserId);
    }
    throw error;
  }
});
