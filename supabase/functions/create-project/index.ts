import { requireSystemAdmin } from "../_shared/auth.ts";
import { configuredOwner, ensureProjectRepository, verifyConfiguredOwner } from "../_shared/github.ts";
import { ApiError, json, readJson, serve } from "../_shared/http.ts";
import { requireKeyEnvelope, requirePublicJwk, requireRepositoryName, requireText, requireUuid } from "../_shared/validation.ts";

interface RequestBody {
  name?: unknown;
  description?: unknown;
  createRepository?: unknown;
  repositoryName?: unknown;
  visibility?: unknown;
  idempotencyKey?: unknown;
  projectId?: unknown;
  ownerKeyEnvelope?: { wrappedKey?: unknown; ephemeralPublicKey?: unknown };
}

serve(async (request) => {
  const { user, admin } = await requireSystemAdmin(request);
  const body = await readJson<RequestBody>(request);
  const name = requireText(body.name, "프로젝트 이름", 1, 120);
  const description = body.description === undefined || body.description === "" ? null : requireText(body.description, "설명", 1, 1000);
  if (body.createRepository !== undefined && typeof body.createRepository !== "boolean") {
    throw new ApiError(400, "INVALID_CREATE_REPOSITORY", "Repository 생성 옵션이 올바르지 않습니다.");
  }
  const createRepository = body.createRepository === true;
  const repositoryName = requireRepositoryName(body.repositoryName);
  if (body.visibility !== undefined && body.visibility !== "private" && body.visibility !== "public") {
    throw new ApiError(400, "INVALID_VISIBILITY", "Repository 공개 범위가 올바르지 않습니다.");
  }
  const visibility = body.visibility === "public" ? "public" : "private";
  const projectId = requireUuid(body.projectId, "Project ID");
  const idempotencyKey = requireUuid(body.idempotencyKey ?? request.headers.get("X-Idempotency-Key"), "Idempotency key");
  const wrappedKey = requireKeyEnvelope(body.ownerKeyEnvelope?.wrappedKey, "wrapped project key");
  const ephemeralPublicKey = requirePublicJwk(body.ownerKeyEnvelope?.ephemeralPublicKey);

  const { data: project, error: beginError } = await admin.rpc("begin_project_creation", {
    p_project_id: projectId,
    p_created_by: user.id,
    p_name: name,
    p_description: description,
    p_repository_name: repositoryName,
    p_visibility: visibility,
    p_idempotency_key: idempotencyKey,
    p_wrapped_key: wrappedKey,
    p_ephemeral_public_key: ephemeralPublicKey
  });
  if (beginError?.code === "PPC01") throw new ApiError(403, "SYSTEM_ADMIN_REQUIRED", "시스템 관리자 권한이 필요합니다.");
  if (beginError || !project) throw new ApiError(500, "PROJECT_TRANSACTION_FAILED", "프로젝트 생성 transaction에 실패했습니다.");
  if (project.created_by !== user.id) throw new ApiError(403, "PROJECT_DENIED", "프로젝트에 접근할 수 없습니다.");
  if (project.status === "active") return json(request, { project, idempotent: true });

  if (!createRepository) {
    const { data: finalized, error: finalizeError } = await admin.rpc("finalize_project_without_repository", {
      p_project_id: project.id
    });
    if (finalizeError || !finalized) {
      throw new ApiError(500, "PROJECT_FINALIZE_FAILED", "프로젝트 생성을 완료할 수 없습니다.");
    }
    console.info(JSON.stringify({ event: "project_created", userId: user.id, projectId: project.id, githubConnected: false }));
    return json(request, { project: finalized }, 201);
  }

  const recordJob = async (status: "pending" | "synced" | "error", errorCode: string | null): Promise<void> => {
    const { data: previous } = await admin.from("github_sync_jobs").select("attempts")
      .eq("project_id", project.id).eq("user_id", user.id).eq("action", "create_repository").maybeSingle();
    await admin.from("github_sync_jobs").upsert({
      project_id: project.id,
      user_id: user.id,
      action: "create_repository",
      status,
      error_code: errorCode,
      attempts: (previous?.attempts ?? 0) + (status === "pending" ? 1 : 0)
    }, { onConflict: "project_id,user_id,action" });
  };

  try {
    await recordJob("pending", null);
    await verifyConfiguredOwner();
    const repository = await ensureProjectRepository({
      projectId: project.id,
      name: project.github_repository_name,
      description: project.description ?? undefined,
      visibility: project.visibility
    });
    const { data: finalized, error: finalizeError } = await admin.rpc("finalize_project_creation", {
      p_project_id: project.id,
      p_repository_id: repository.id,
      p_owner: configuredOwner(),
      p_repository_name: repository.name,
      p_repository_url: repository.html_url
    });
    if (finalizeError || !finalized) throw new ApiError(500, "PROJECT_FINALIZE_FAILED", "GitHub Repository 연결을 저장할 수 없습니다.");
    await recordJob("synced", null);
    console.info(JSON.stringify({ event: "project_created", userId: user.id, projectId: project.id, repositoryId: repository.id }));
    return json(request, { project: finalized }, 201);
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "GITHUB_API_FAILED";
    const [, marked] = await Promise.allSettled([
      recordJob("error", code),
      admin.rpc("mark_project_github_error", { p_project_id: project.id, p_error_code: code })
    ]);
    if (marked.status !== "fulfilled" || marked.value.error || !marked.value.data) {
      throw new ApiError(500, "PROJECT_FINALIZE_FAILED", "프로젝트 생성 상태를 저장할 수 없습니다.");
    }
    console.warn(JSON.stringify({ event: "project_created_github_pending", userId: user.id, projectId: project.id, errorCode: code }));
    return json(request, { project: marked.value.data, integrationWarning: code }, 201);
  }
});
