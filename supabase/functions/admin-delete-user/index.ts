import { requireSystemAdmin } from "../_shared/auth.ts";
import { removeCollaborator } from "../_shared/github.ts";
import { ApiError, json, readJson, serve } from "../_shared/http.ts";
import { requireText, requireUuid } from "../_shared/validation.ts";

serve(async (request) => {
  const { user, admin } = await requireSystemAdmin(request);
  const body = await readJson<{ userId?: unknown; confirmation?: unknown }>(request);
  const targetId = requireUuid(body.userId, "User ID");
  if (targetId === user.id) throw new ApiError(409, "CANNOT_DELETE_SELF", "현재 로그인한 계정은 삭제할 수 없습니다.");
  const { data: profile } = await admin.from("profiles").select("id, student_id, name, github_username, system_role").eq("id", targetId).maybeSingle();
  if (!profile) throw new ApiError(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.");
  if (profile.system_role === "admin") throw new ApiError(409, "SYSTEM_ADMIN_PROTECTED", "system_admin 계정은 삭제할 수 없습니다.");
  if (requireText(body.confirmation, "학번 확인", 1, 20) !== profile.student_id) throw new ApiError(400, "DELETE_CONFIRMATION_MISMATCH", "삭제 확인 학번이 일치하지 않습니다.");
  const { count: owned } = await admin.from("projects").select("id", { count: "exact", head: true }).eq("created_by", targetId);
  if ((owned ?? 0) > 0) throw new ApiError(409, "USER_OWNS_PROJECTS", "소유한 프로젝트를 먼저 다른 방식으로 정리해야 합니다.");
  if (profile.github_username) {
    const { data: memberships, error } = await admin.from("project_members").select("project:projects!inner(github_repository_name, github_repository_url, github_auto_sync)").eq("user_id", targetId);
    if (error) throw new ApiError(500, "USER_DELETE_CHECK_FAILED", "사용자 프로젝트를 확인할 수 없습니다.");
    try {
      for (const membership of memberships ?? []) {
        const project = Array.isArray(membership.project) ? membership.project[0] : membership.project;
        if (project?.github_auto_sync && project.github_repository_url) await removeCollaborator(project.github_repository_name, profile.github_username);
      }
    } catch {
      throw new ApiError(502, "GITHUB_COLLABORATOR_CLEANUP_FAILED", "GitHub collaborator 정리에 실패해 계정 삭제를 중단했습니다.");
    }
  }
  const { error: auditError } = await admin.from("admin_audit_logs").insert({ actor_id: user.id, action: "user_deleted", target_user_id: targetId, details: { student_id_snapshot: profile.student_id, display_name_snapshot: profile.name } });
  if (auditError) throw new ApiError(500, "AUDIT_LOG_FAILED", "삭제 감사 기록을 저장할 수 없습니다.");
  const { error } = await admin.auth.admin.deleteUser(targetId);
  if (error) throw new ApiError(500, "AUTH_USER_DELETE_FAILED", "Auth 사용자를 삭제할 수 없습니다.");
  return json(request, { deleted: true });
});
