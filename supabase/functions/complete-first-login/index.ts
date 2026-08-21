import { requireUser } from "../_shared/auth.ts";
import { decideFirstLoginAction, isSamePasswordAuthError } from "../_shared/firstLoginPolicy.ts";
import { ApiError, json, readJson, serve } from "../_shared/http.ts";

interface FirstLoginRequest {
  derivedCredential?: unknown;
  keyring?: {
    encryptionPublicKey?: unknown;
    encryptedPrivateKey?: unknown;
    keySalt?: unknown;
    keyKdfIterations?: unknown;
  };
}

interface ProfileState {
  account_status: "password_change_required" | "active" | "inactive";
  encryption_public_key: unknown | null;
  encrypted_private_key: unknown | null;
  key_salt: string | null;
}

type Phase = "inspect" | "credential_update" | "profile_finalize" | "metadata_update" | "verify";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasPersistedKeyring(profile: ProfileState): boolean {
  return Boolean(profile.encryption_public_key && profile.encrypted_private_key && profile.key_salt);
}

function validateRequest(body: FirstLoginRequest) {
  if (typeof body.derivedCredential !== "string" || !/^[a-f0-9]{64}$/u.test(body.derivedCredential)) {
    throw new ApiError(400, "DERIVED_CREDENTIAL_INVALID", "로그인 암호 요청 형식이 올바르지 않습니다.");
  }
  const keyring = body.keyring;
  if (!keyring || !isObject(keyring.encryptionPublicKey) || !isObject(keyring.encryptedPrivateKey)) {
    throw new ApiError(400, "KEYRING_INVALID", "암호화 keyring 요청 형식이 올바르지 않습니다.");
  }
  const publicKey = keyring.encryptionPublicKey;
  if (
    publicKey.kty !== "EC"
    || publicKey.crv !== "P-256"
    || typeof publicKey.x !== "string"
    || typeof publicKey.y !== "string"
    || "d" in publicKey
  ) {
    throw new ApiError(400, "KEYRING_PUBLIC_KEY_INVALID", "암호화 공개키 형식이 올바르지 않습니다.");
  }
  const encrypted = keyring.encryptedPrivateKey;
  if (
    encrypted.version !== 1
    || encrypted.algorithm !== "AES-256-GCM"
    || typeof encrypted.iv !== "string"
    || !/^[A-Za-z0-9_-]{16}$/u.test(encrypted.iv)
    || typeof encrypted.ciphertext !== "string"
    || encrypted.ciphertext.length < 32
    || encrypted.ciphertext.length > 16_384
    || !/^[A-Za-z0-9_-]+$/u.test(encrypted.ciphertext)
  ) {
    throw new ApiError(400, "KEYRING_PRIVATE_KEY_INVALID", "암호화 private key 형식이 올바르지 않습니다.");
  }
  if (
    typeof keyring.keySalt !== "string"
    || !/^[A-Za-z0-9_-]{22,256}$/u.test(keyring.keySalt)
    || !Number.isInteger(keyring.keyKdfIterations)
    || (keyring.keyKdfIterations as number) < 310_000
    || (keyring.keyKdfIterations as number) > 2_000_000
  ) {
    throw new ApiError(400, "KEYRING_KDF_INVALID", "암호화 keyring KDF 형식이 올바르지 않습니다.");
  }
  return {
    derivedCredential: body.derivedCredential,
    encryptionPublicKey: publicKey,
    encryptedPrivateKey: encrypted,
    keySalt: keyring.keySalt,
    keyKdfIterations: keyring.keyKdfIterations as number
  };
}

function safeErrorCode(error: unknown, fallback: string): string {
  if (!isObject(error) || typeof error.code !== "string") return fallback;
  return /^[A-Za-z0-9_]{1,64}$/u.test(error.code) ? error.code : fallback;
}

function logEvent(fields: {
  event: "first_login_completed" | "first_login_failed";
  userId: string;
  phase: Phase;
  code: string;
  mustChangeBefore: boolean;
  mustChangeAfter?: boolean;
  keyringInitialized: boolean;
}): void {
  const output = JSON.stringify(fields);
  if (fields.event === "first_login_failed") console.error(output);
  else console.info(output);
}

serve(async (request) => {
  const { user: caller, admin } = await requireUser(request);
  let phase: Phase = "inspect";
  let mustChangeBefore = caller.app_metadata.must_change_password === true;
  let keyringInitialized = false;

  try {
    const body = validateRequest(await readJson<FirstLoginRequest>(request));
    const [{ data: authData, error: authReadError }, { data: profileData, error: profileError }] = await Promise.all([
      admin.auth.admin.getUserById(caller.id),
      admin
        .from("profiles")
        .select("account_status, encryption_public_key, encrypted_private_key, key_salt")
        .eq("id", caller.id)
        .single()
    ]);
    const authUser = authData.user;
    const profile = profileData as ProfileState | null;
    if (authReadError || !authUser) throw new ApiError(401, "AUTH_USER_NOT_FOUND", "Auth 사용자를 확인할 수 없습니다.");
    if (profileError || !profile) throw new ApiError(404, "PROFILE_NOT_FOUND", "사용자 프로필을 찾을 수 없습니다.");
    if (profile.account_status === "inactive" || authUser.app_metadata.account_active === false) {
      throw new ApiError(403, "ACCOUNT_INACTIVE", "비활성화된 계정입니다.");
    }

    mustChangeBefore = authUser.app_metadata.must_change_password === true;
    keyringInitialized = hasPersistedKeyring(profile);
    const action = decideFirstLoginAction(mustChangeBefore, profile.account_status, keyringInitialized);
    if (action === "already_completed") {
      logEvent({
        event: "first_login_completed",
        userId: caller.id,
        phase: "verify",
        code: "ALREADY_COMPLETED",
        mustChangeBefore,
        mustChangeAfter: false,
        keyringInitialized
      });
      return json(request, { completed: true, alreadyCompleted: true, keyringReused: true });
    }

    // profile과 keyring이 이미 완료되었다면 이전 요청에서 credential/DB 단계가 끝난 상태다.
    // 이 경우 password를 다시 변경하지 않고 metadata reconcile만 수행한다.
    if (action === "update_credential_and_finalize") {
      phase = "credential_update";
      const { error: passwordError } = await admin.auth.admin.updateUserById(caller.id, {
        password: body.derivedCredential
      });
      if (passwordError && !isSamePasswordAuthError(passwordError)) {
        throw new ApiError(502, "AUTH_CREDENTIAL_UPDATE_FAILED", "새 로그인 암호를 설정할 수 없습니다.");
      }
    }

    phase = "profile_finalize";
    const { data: result, error: finalizeError } = await admin.rpc("finalize_first_login_profile", {
      p_user_id: caller.id,
      p_encryption_public_key: body.encryptionPublicKey,
      p_encrypted_private_key: body.encryptedPrivateKey,
      p_key_salt: body.keySalt,
      p_key_kdf_iterations: body.keyKdfIterations
    });
    if (finalizeError) {
      const code = safeErrorCode(finalizeError, "PROFILE_FINALIZE_FAILED");
      if (code === "PFL02") throw new ApiError(404, code, "사용자 프로필을 찾을 수 없습니다.");
      if (code === "PFL03") throw new ApiError(403, code, "비활성화된 계정입니다.");
      throw new ApiError(500, code, "최초 로그인 프로필 완료 상태를 저장할 수 없습니다.");
    }
    const resultRecord = isObject(result) ? result : {};
    keyringInitialized = resultRecord.keyring_initialized === true;

    phase = "metadata_update";
    const { data: latestAuth, error: latestAuthError } = await admin.auth.admin.getUserById(caller.id);
    if (latestAuthError || !latestAuth.user) {
      throw new ApiError(502, "AUTH_USER_REFRESH_FAILED", "Auth 사용자 상태를 다시 확인할 수 없습니다.");
    }
    const { error: metadataError } = await admin.auth.admin.updateUserById(caller.id, {
      app_metadata: {
        ...latestAuth.user.app_metadata,
        must_change_password: false,
        account_active: true
      }
    });
    if (metadataError) throw new ApiError(502, "AUTH_METADATA_UPDATE_FAILED", "Auth 완료 상태를 저장할 수 없습니다.");

    phase = "verify";
    const [{ data: verifiedAuth, error: verifyAuthError }, { data: verifiedProfile, error: verifyProfileError }] = await Promise.all([
      admin.auth.admin.getUserById(caller.id),
      admin
        .from("profiles")
        .select("account_status, encryption_public_key, encrypted_private_key, key_salt")
        .eq("id", caller.id)
        .single()
    ]);
    const verified = verifiedProfile as ProfileState | null;
    const mustChangeAfter = verifiedAuth.user?.app_metadata.must_change_password === true;
    keyringInitialized = Boolean(verified && hasPersistedKeyring(verified));
    if (
      verifyAuthError
      || verifyProfileError
      || !verifiedAuth.user
      || !verified
      || mustChangeAfter
      || verified.account_status !== "active"
      || !keyringInitialized
    ) {
      throw new ApiError(500, "FIRST_LOGIN_VERIFY_FAILED", "최초 로그인 완료 상태를 확인할 수 없습니다. 같은 암호로 다시 시도하세요.");
    }

    logEvent({
      event: "first_login_completed",
      userId: caller.id,
      phase,
      code: "COMPLETED",
      mustChangeBefore,
      mustChangeAfter: false,
      keyringInitialized
    });
    return json(request, {
      completed: true,
      alreadyCompleted: false,
      keyringReused: resultRecord.keyring_reused === true
    });
  } catch (error) {
    logEvent({
      event: "first_login_failed",
      userId: caller.id,
      phase,
      code: error instanceof ApiError ? error.code : safeErrorCode(error, "INTERNAL_ERROR"),
      mustChangeBefore,
      keyringInitialized
    });
    throw error;
  }
});
