import { createClient } from "npm:@supabase/supabase-js@2";
import { deriveInitialAuthCredential } from "../_shared/authCredential.ts";
import { normalizeStudentId, studentIdToInternalEmail } from "../_shared/identity.ts";
import { ApiError, readJson } from "../_shared/http.ts";
import { requireText } from "../_shared/validation.ts";

interface RequestBody {
  studentId?: unknown;
  name?: unknown;
}

interface BootstrapState {
  status: "ready" | "completed";
  user_id?: string | null;
  auth_user_exists?: boolean;
  profile_exists?: boolean;
  must_change_password?: boolean | null;
}

class BootstrapError extends ApiError {
  constructor(
    status: number,
    code: string,
    message: string,
    public readonly diagnostic: Record<string, string> = {}
  ) {
    super(status, code, message);
  }
}

const SAFE_DATABASE_ERRORS: Record<string, string> = {
  "42501": "BOOTSTRAP_SERVICE_ROLE_REQUIRED",
  PBA01: "BOOTSTRAP_ALREADY_COMPLETED_FOR_OTHER_USER",
  PBA02: "BOOTSTRAP_COMPLETED_STATE_INVALID",
  PBA03: "BOOTSTRAP_EXISTING_AUTH_USER_NOT_RECOVERABLE",
  PBA04: "BOOTSTRAP_PROFILE_WITHOUT_MATCHING_AUTH_USER",
  PBA05: "BOOTSTRAP_ANOTHER_ADMIN_EXISTS",
  PBA06: "BOOTSTRAP_CLAIM_IN_PROGRESS",
  PBA07: "BOOTSTRAP_CLAIM_NOT_ACTIVE",
  PBA08: "BOOTSTRAP_AUTH_USER_INVALID",
  PBA09: "BOOTSTRAP_IDENTITY_CONFLICT",
  PBA10: "BOOTSTRAP_INVALID_STUDENT_ID",
  PBA11: "BOOTSTRAP_INVALID_NAME",
  PBA12: "BOOTSTRAP_PROFILE_INVALID"
};

function safeCode(value: unknown, fallback: string): string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/u.test(value) ? value : fallback;
}

function databaseFailure(phase: string, error: { code?: string } | null): BootstrapError {
  const dbCode = safeCode(error?.code, "DB_UNKNOWN");
  const databaseError = SAFE_DATABASE_ERRORS[dbCode] ?? "DATABASE_OPERATION_FAILED";
  const conflict = dbCode.startsWith("PBA") && dbCode !== "PBA07";
  return new BootstrapError(
    conflict ? 409 : 500,
    `BOOTSTRAP_${phase}_FAILED`,
    phase === "PREPARE" ? "Bootstrap 상태를 준비할 수 없습니다." : "Bootstrap 완료 상태를 저장할 수 없습니다.",
    { phase, dbCode, databaseError }
  );
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function secretsMatch(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected))
  ]);
  const left = new Uint8Array(providedHash);
  const right = new Uint8Array(expectedHash);
  let difference = left.length ^ right.length;
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return reply({ error: "허용되지 않은 method입니다.", code: "METHOD_NOT_ALLOWED" }, 405);
  if (request.headers.has("Origin")) return reply({ error: "Browser 요청은 허용되지 않습니다.", code: "BROWSER_DENIED" }, 403);

  try {
    const configuredSecret = Deno.env.get("SYSTEM_ADMIN_BOOTSTRAP_SECRET") ?? "";
    const authorization = request.headers.get("Authorization") ?? "";
    const providedSecret = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (configuredSecret.length < 32 || !await secretsMatch(providedSecret, configuredSecret)) {
      throw new ApiError(401, "BOOTSTRAP_AUTH_FAILED", "Bootstrap 인증에 실패했습니다.");
    }

    const body = await readJson<RequestBody>(request, 8_192);
    const studentId = normalizeStudentId(body.studentId);
    const name = requireText(body.name, "이름", 1, 80);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase function secrets are incomplete");
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const claimId = crypto.randomUUID();
    const prepare = async (): Promise<BootstrapState> => {
      const { data, error } = await admin.rpc("prepare_system_admin_bootstrap", {
        p_claim_id: claimId,
        p_student_id: studentId
      });
      if (error) throw databaseFailure("PREPARE", error);
      return data as BootstrapState;
    };

    let state = await prepare();
    if (state.status === "completed" && state.user_id) {
      const requiresInitialPassword = state.must_change_password !== false;
      return reply({
        created: false,
        recovered: true,
        alreadyCompleted: true,
        requiresInitialPassword,
        studentId,
        name,
        next: requiresInitialPassword
          ? "학번과 초기 비밀번호 1234로 로그인한 뒤 최초 비밀번호 변경을 완료하세요."
          : "학번과 현재 PIN 또는 비밀번호로 로그인하세요."
      });
    }

    let userId = state.user_id ?? null;
    let created = false;
    const reusedExistingUser = Boolean(userId);

    if (!userId) {
      const authCredential = await deriveInitialAuthCredential(studentId);
      const { data, error } = await admin.auth.admin.createUser({
        email: studentIdToInternalEmail(studentId),
        password: authCredential,
        email_confirm: true,
        user_metadata: { student_id: studentId, name },
        app_metadata: { must_change_password: true, system_role: "admin", account_active: true }
      });
      if (!error && data.user) {
        userId = data.user.id;
        created = true;
      } else {
        state = await prepare();
        userId = state.user_id ?? null;
        if (!userId) {
          await admin.rpc("release_system_admin_bootstrap_recovery", { p_claim_id: claimId });
          throw new BootstrapError(
            409,
            "BOOTSTRAP_USER_CREATE_FAILED",
            "Bootstrap 관리자 계정을 생성하거나 복구할 수 없습니다.",
            { phase: "AUTH_CREATE", authCode: safeCode(error?.code, "AUTH_UNKNOWN") }
          );
        }
      }
    }

    const { data: finalized, error: finalizeError } = await admin.rpc("finalize_system_admin_bootstrap_recovery", {
      p_claim_id: claimId,
      p_user_id: userId,
      p_student_id: studentId,
      p_name: name
    });
    if (finalizeError) throw databaseFailure("FINALIZE", finalizeError);

    const finalizeState = finalized as { audit_logged?: boolean; profile_created?: boolean } | null;
    const requiresInitialPassword = created || state.must_change_password !== false;
    console.info(JSON.stringify({
      event: "system_admin_bootstrapped",
      userId,
      recovered: reusedExistingUser || !created,
      auditLogged: finalizeState?.audit_logged !== false
    }));
    return reply({
      created,
      recovered: reusedExistingUser || !created,
      profileCreatedDuringRecovery: finalizeState?.profile_created === true,
      requiresInitialPassword,
      studentId,
      name,
      next: requiresInitialPassword
        ? "학번과 초기 비밀번호 1234로 로그인한 뒤 최초 비밀번호 변경을 완료하세요."
        : "학번과 현재 PIN 또는 비밀번호로 로그인하세요."
    }, created ? 201 : 200);
  } catch (error) {
    if (error instanceof BootstrapError) {
      return reply({ error: error.message, code: error.code, ...error.diagnostic }, error.status);
    }
    if (error instanceof ApiError) return reply({ error: error.message, code: error.code }, error.status);
    console.error(JSON.stringify({ event: "system_admin_bootstrap_error", code: "INTERNAL_ERROR" }));
    return reply({ error: "Bootstrap 요청을 처리할 수 없습니다.", code: "INTERNAL_ERROR" }, 500);
  }
});
