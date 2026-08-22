import { requireReadyUser } from "../_shared/auth.ts";
import { deleteRepository, getRepository, isRepositoryForProject } from "../_shared/github.ts";
import { ApiError, json, readJson, serve } from "../_shared/http.ts";
import { requireText, requireUuid } from "../_shared/validation.ts";

async function listStoragePaths(admin: Awaited<ReturnType<typeof requireReadyUser>>["admin"], prefix: string): Promise<string[]> {
  const paths: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await admin.storage.from("project-files").list(prefix, { limit: 100, offset });
    if (error) throw new ApiError(500, "STORAGE_CLEANUP_FAILED", "프로젝트 파일을 확인할 수 없습니다.");
    for (const item of data ?? []) {
      const path = `${prefix}/${item.name}`;
      if (item.id) paths.push(path);
      else paths.push(...await listStoragePaths(admin, path));
    }
    if ((data?.length ?? 0) < 100) break;
  }
  return paths;
}

serve(async (request) => {
  const { user, admin } = await requireReadyUser(request);
  const body = await readJson<{ projectId?: unknown; confirmation?: unknown }>(request);
  const projectId = requireUuid(body.projectId, "Project ID");
  const confirmation = requireText(body.confirmation, "확인 문구", 1, 120);
  const [{ data: project }, { data: member }] = await Promise.all([
    admin.from("projects").select("id, name, github_repository_name").eq("id", projectId).single(),
    admin.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).single()
  ]);
  if (!project || member?.role !== "owner") throw new ApiError(403, "PROJECT_OWNER_REQUIRED", "Project Owner만 프로젝트를 삭제할 수 있습니다.");
  if (confirmation !== project.name) throw new ApiError(400, "CONFIRMATION_MISMATCH", "프로젝트 이름이 일치하지 않습니다.");

  const repository = await getRepository(project.github_repository_name);
  if (repository) {
    if (!isRepositoryForProject(repository, projectId)) {
      throw new ApiError(409, "REPOSITORY_PROJECT_MISMATCH", "이 프로젝트가 생성한 Repository인지 확인할 수 없습니다.");
    }
    await deleteRepository(project.github_repository_name);
  }

  const { data: storedFiles, error: fileListError } = await admin.from("files").select("storage_path").eq("project_id", projectId);
  if (fileListError) throw new ApiError(500, "STORAGE_CLEANUP_FAILED", "프로젝트 파일 목록을 확인할 수 없습니다.");
  const discoveredPaths = await listStoragePaths(admin, projectId);
  const paths = [...new Set([...(storedFiles ?? []).map((file) => file.storage_path), ...discoveredPaths])];
  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await admin.storage.from("project-files").remove(paths.slice(index, index + 100));
    if (error) throw new ApiError(500, "STORAGE_CLEANUP_FAILED", "프로젝트 파일을 정리할 수 없습니다.");
  }

  const { data: deleted, error: deleteError } = await admin.from("projects").delete().eq("id", projectId).select("id").maybeSingle();
  if (deleteError || !deleted) throw new ApiError(500, "PROJECT_DELETE_FAILED", "프로젝트 데이터를 삭제할 수 없습니다.");
  console.info(JSON.stringify({ event: "project_deleted", userId: user.id, projectId, repositoryExisted: Boolean(repository) }));
  return json(request, { deleted: true });
});
