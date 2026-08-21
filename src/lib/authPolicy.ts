import type { User } from "@supabase/supabase-js";
import type { Profile } from "../types/domain";

export type PasswordMode = "pin" | "password";

export function mustChangePassword(user: Pick<User, "app_metadata"> | null): boolean {
  return user?.app_metadata.must_change_password === true;
}

export function profileHasKeyring(profile: Profile | null): boolean {
  return Boolean(
    profile?.encryption_public_key
    && profile.encrypted_private_key
    && profile.key_salt
  );
}

/**
 * profiles.account_status is the durable account lifecycle state. Auth
 * app_metadata mirrors it into the JWT so RLS can fail closed immediately.
 * A mismatch or a missing keyring therefore always returns to the recoverable
 * first-login flow instead of treating either copy as completed on its own.
 */
export function needsFirstLogin(user: Pick<User, "app_metadata"> | null, profile: Profile | null): boolean {
  if (!user) return false;
  return mustChangePassword(user)
    || profile?.account_status === "password_change_required"
    || (profile?.account_status === "active" && !profileHasKeyring(profile));
}

export function isSystemAdmin(user: Pick<User, "app_metadata"> | null, profile: Profile | null): boolean {
  return user?.app_metadata.system_role === "admin"
    && user.app_metadata.must_change_password === false
    && profile?.system_role === "admin"
    && profile.account_status === "active";
}

export function validateNewPassword(mode: PasswordMode, password: string): string | null {
  if (mode === "pin" && !/^\d{4}$/u.test(password)) return "PIN은 정확히 숫자 4자리여야 합니다.";
  if (mode === "password" && password.length < 4) return "비밀번호는 4자 이상이어야 합니다.";
  return null;
}

export function canEnterBusinessRoutes(user: Pick<User, "app_metadata"> | null, profile: Profile | null): boolean {
  return Boolean(
    user
    && profile?.account_status === "active"
    && user.app_metadata.must_change_password === false
    && user.app_metadata.account_active !== false
  );
}
