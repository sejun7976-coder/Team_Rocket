import { requireReadyUser } from "../_shared/auth.ts";
import { removeCollaborator } from "../_shared/github.ts";
import { ApiError, json, readJson, serve } from "../_shared/http.ts";
import { requireUuid } from "../_shared/validation.ts";

serve(async (request) => {
  const { user, admin } = await requireReadyUser(request);
  const body = await readJson<{ projectId?: unknown; userId?: unknown }>(request);
  const projectId = requireUuid(body.projectId, "Project ID");
  const userId = requireUuid(body.userId, "User ID");
  const [{ data: project }, { data: profile }] = await Promise.all([
    admin.from("projects").select("github_repository_name, github_auto_sync").eq("id", projectId).single(),
    admin.from("profiles").select("github_username").eq("id", userId).single()
  ]);
  const { error } = await admin.rpc("remove_project_member_atomic", {
    p_actor_id: user.id,
    p_project_id: projectId,
    p_user_id: userId
  });
  if (error) throw new ApiError(403, "MEMBER_REMOVE_DENIED", "팀원을 제거할 권한이 없거나 Owner는 제거할 수 없습니다.");

  let githubSyncStatus = "not_connected";
  let githubErrorCode: string | null = null;
  if (project?.github_auto_sync && profile?.github_username) {
    await admin.from("github_sync_jobs").upsert({
      project_id: projectId, user_id: userId, action: "remove_collaborator", status: "pending", error_code: null
    }, { onConflict: "project_id,user_id,action" });
    try {
      await removeCollaborator(project.github_repository_name, profile.github_username);
      githubSyncStatus = "synced";
    } catch (githubError) {
      githubSyncStatus = "error";
      githubErrorCode = githubError instanceof ApiError ? githubError.code : "GITHUB_API_FAILED";
    }
    await admin.from("github_sync_jobs").update({
      status: githubSyncStatus, error_code: githubErrorCode, attempts: 1
    }).eq("project_id", projectId).eq("user_id", userId).eq("action", "remove_collaborator");
  }
  console.info(JSON.stringify({ event: "project_member_removed", userId: user.id, projectId, targetUserId: userId, githubSyncStatus }));
  return json(request, { removed: true, githubSyncStatus, githubErrorCode });
});
