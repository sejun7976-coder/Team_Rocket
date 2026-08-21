import { requireSystemAdmin } from "../_shared/auth.ts";
import { deriveInitialAuthCredential } from "../_shared/authCredential.ts";
import { INITIAL_PASSWORD, normalizeStudentId, studentIdToInternalEmail } from "../_shared/identity.ts";
import { ApiError, json, readJson, serve } from "../_shared/http.ts";
import { GITHUB_USER_PATTERN, requireText } from "../_shared/validation.ts";

interface RequestBody {
  studentId?: unknown;
  name?: unknown;
  githubUsername?: unknown;
}

serve(async (request) => {
  const { user: actor, admin } = await requireSystemAdmin(request);
  const body = await readJson<RequestBody>(request);
  const studentId = normalizeStudentId(body.studentId);
  const name = requireText(body.name, "이름", 1, 80);
  const githubUsername = body.githubUsername === undefined || body.githubUsername === ""
    ? null
    : requireText(body.githubUsername, "GitHub Username", 1, 39);
  if (githubUsername && !GITHUB_USER_PATTERN.test(githubUsername)) {
    throw new ApiError(400, "INVALID_GITHUB_USERNAME", "GitHub Username 형식이 올바르지 않습니다.");
  }

  const { data: duplicate } = await admin.from("profiles").select("id").eq("student_id", studentId).maybeSingle();
  if (duplicate) throw new ApiError(409, "STUDENT_ID_EXISTS", "이미 등록된 학번입니다.");

  const authCredential = await deriveInitialAuthCredential(studentId);
  const { data, error } = await admin.auth.admin.createUser({
    email: studentIdToInternalEmail(studentId),
    password: authCredential,
    email_confirm: true,
    user_metadata: { student_id: studentId, name },
    app_metadata: { must_change_password: true, system_role: "user", account_active: true }
  });
  if (error || !data.user) {
    if (/already|registered|exists/iu.test(error?.message ?? "")) {
      throw new ApiError(409, "STUDENT_ID_EXISTS", "이미 등록된 학번입니다.");
    }
    throw new ApiError(502, "AUTH_USER_CREATE_FAILED", "Supabase Auth 사용자를 생성할 수 없습니다.");
  }

  const authUser = data.user;
  const { data: profile, error: profileError } = await admin.from("profiles").update({
    name,
    github_username: githubUsername,
    system_role: "user",
    account_status: "password_change_required",
    created_by: actor.id
  }).eq("id", authUser.id).select("id, student_id, name, github_username, system_role, account_status, created_at").single();

  if (profileError || !profile) {
    await admin.auth.admin.deleteUser(authUser.id);
    throw new ApiError(500, "PROFILE_CREATE_FAILED", "프로필 생성에 실패하여 Auth 계정을 되돌렸습니다.");
  }

  await admin.from("admin_audit_logs").insert({
    actor_id: actor.id,
    action: "user_created",
    target_user_id: authUser.id,
    details: { student_id: studentId }
  });
  return json(request, { user: profile, initialPassword: INITIAL_PASSWORD }, 201);
});
