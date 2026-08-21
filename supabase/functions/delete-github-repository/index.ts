import { requireReadyUser } from "../_shared/auth.ts";
import { deleteRepository } from "../_shared/github.ts";
import { ApiError, json, readJson, serve } from "../_shared/http.ts";
import { requireText, requireUuid } from "../_shared/validation.ts";

serve(async (request) => {
  const { user, admin } = await requireReadyUser(request);
  const body = await readJson<{ projectId?: unknown; confirmation?: unknown }>(request);
  const projectId = requireUuid(body.projectId, "Project ID");
  const confirmation = requireText(body.confirmation, "확인 문구", 1, 120);
  const [{ data: project }, { data: member }] = await Promise.all([
    admin.from("projects").select("name, github_repository_name").eq("id", projectId).single(),
    admin.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).single()
  ]);
  if (!project || member?.role !== "owner") throw new ApiError(403, "OWNER_REQUIRED", "Owner만 Repository를 삭제할 수 있습니다.");
  if (confirmation !== project.name) throw new ApiError(400, "CONFIRMATION_MISMATCH", "프로젝트 이름이 일치하지 않습니다.");
  await deleteRepository(project.github_repository_name);
  await admin.from("projects").update({
    github_repository_id: null,
    github_repository_url: null,
    github_sync_status: "not_connected",
    github_error_code: null
  }).eq("id", projectId);
  console.info(JSON.stringify({ event: "github_repository_deleted", userId: user.id, projectId }));
  return json(request, { deleted: true });
});
