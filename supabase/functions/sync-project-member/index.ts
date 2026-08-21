import { requireReadyUser } from "../_shared/auth.ts";
import { addCollaborator } from "../_shared/github.ts";
import { ApiError, json, readJson, serve } from "../_shared/http.ts";
import { requireKeyEnvelope, requirePublicJwk, requireUuid } from "../_shared/validation.ts";

interface RequestBody {
  projectId?: unknown;
  userId?: unknown;
  role?: unknown;
  preserveMembership?: unknown;
  wrappedKey?: unknown;
  ephemeralPublicKey?: unknown;
}

serve(async (request) => {
  const { user, admin } = await requireReadyUser(request);
  const body = await readJson<RequestBody>(request);
  const projectId = requireUuid(body.projectId, "Project ID");
  const userId = requireUuid(body.userId, "User ID");
  const role = ["admin", "member", "viewer"].includes(String(body.role)) ? String(body.role) : "member";
  const wrappedKey = requireKeyEnvelope(body.wrappedKey, "wrapped project key");
  const ephemeralPublicKey = requirePublicJwk(body.ephemeralPublicKey);

  if (body.preserveMembership === true) {
    const { data: member, error } = await admin.rpc("rewrap_project_key_atomic", {
      p_actor_id: user.id,
      p_project_id: projectId,
      p_user_id: userId,
      p_wrapped_key: wrappedKey,
      p_ephemeral_public_key: ephemeralPublicKey
    });
    if (error || !member) throw new ApiError(403, "PROJECT_KEY_REWRAP_DENIED", "프로젝트 암호화 키를 다시 공유할 권한이 없습니다.");
    console.info(JSON.stringify({ event: "project_key_rewrapped", userId: user.id, projectId, targetUserId: userId }));
    return json(request, { member, rewrapped: true });
  }

  const { data: member, error } = await admin.rpc("add_project_member_atomic", {
    p_actor_id: user.id,
    p_project_id: projectId,
    p_user_id: userId,
    p_role: role,
    p_wrapped_key: wrappedKey,
    p_ephemeral_public_key: ephemeralPublicKey
  });
  if (error || !member) throw new ApiError(403, "MEMBER_SYNC_DENIED", "팀원을 추가할 권한이 없습니다.");

  const [{ data: project }, { data: profile }] = await Promise.all([
    admin.from("projects").select("github_repository_name, github_auto_sync").eq("id", projectId).single(),
    admin.from("profiles").select("github_username").eq("id", userId).single()
  ]);
  let githubSyncStatus = "not_connected";
  let githubErrorCode: string | null = null;
  if (project?.github_auto_sync && profile?.github_username) {
    try {
      await addCollaborator(project.github_repository_name, profile.github_username);
      githubSyncStatus = "synced";
    } catch (githubError) {
      githubSyncStatus = "error";
      githubErrorCode = githubError instanceof ApiError ? githubError.code : "GITHUB_API_FAILED";
    }
  }
  await admin.from("project_members").update({ github_sync_status: githubSyncStatus, github_error_code: githubErrorCode })
    .eq("project_id", projectId).eq("user_id", userId);
  console.info(JSON.stringify({ event: "project_member_added", userId: user.id, projectId, targetUserId: userId, githubSyncStatus }));
  return json(request, { member: { ...member, github_sync_status: githubSyncStatus, github_error_code: githubErrorCode } });
});
