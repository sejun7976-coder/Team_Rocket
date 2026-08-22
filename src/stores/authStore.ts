import type { Session, User } from "@supabase/supabase-js";
import { create } from "zustand";
import {
  createUserKeyring,
  clearExpiredSessionKeyrings,
  clearSessionKeyring,
  persistSessionKeyring,
  protectUnlockedUserKeyring,
  restoreSessionKeyring,
  unlockUserKeyring,
  type UnlockedUserKeyring,
  type UserKeyringRecord
} from "../crypto";
import { deriveAuthCredential } from "../../supabase/functions/_shared/authCredential";
import { needsFirstLogin } from "../lib/authPolicy";
import { reauthenticateAfterFirstLogin, type FirstLoginAuthClient } from "../lib/firstLoginReauthentication";
import { AuthenticatedFunctionError, invokeAuthenticatedFunction } from "../lib/authenticatedFunction";
import { supabase } from "../lib/supabase";
import { studentIdToInternalEmail } from "../lib/utils";
import { recordAccessEventBestEffort, recordAccessEvent } from "../services/accessLogs";
import type { Profile } from "../types/domain";

export type LoginDestination = "first-login" | "dashboard";

interface AuthStore {
  initialized: boolean;
  keyringHydrated: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  keyring: UnlockedUserKeyring | null;
  error: string | null;
  initialize: () => Promise<void>;
  login: (studentId: string, credential: string) => Promise<LoginDestination>;
  completeFirstLogin: (newCredential: string) => Promise<void>;
  unlockKeyring: (credential: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  lockKeyring: () => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 처리할 수 없습니다.";
}

async function persistSessionKeyringWhenSupported(userId: string, keyring: UnlockedUserKeyring): Promise<void> {
  try {
    await persistSessionKeyring(userId, keyring);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("SECURE_SESSION_STORAGE_")) return;
    throw error;
  }
}

async function fetchProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
  if (error || !data) throw new Error("사용자 프로필을 불러올 수 없습니다.");
  return data as Profile;
}

function keyringRecord(profile: Profile): UserKeyringRecord | null {
  if (!profile.encryption_public_key || !profile.encrypted_private_key || !profile.key_salt) return null;
  return {
    encryptionPublicKey: profile.encryption_public_key,
    encryptedPrivateKey: profile.encrypted_private_key,
    keySalt: profile.key_salt,
    keyKdfIterations: profile.key_kdf_iterations
  };
}

async function saveKeyring(userId: string, record: UserKeyringRecord): Promise<void> {
  const { error } = await supabase.from("profiles").update({
    encryption_public_key: record.encryptionPublicKey,
    encrypted_private_key: record.encryptedPrivateKey,
    key_salt: record.keySalt,
    key_kdf_iterations: record.keyKdfIterations
  }).eq("id", userId);
  if (error) throw new Error("사용자 보안 키를 저장할 수 없습니다.");
}

function accountIsInactive(user: User, profile: Profile): boolean {
  return profile.account_status === "inactive" || user.app_metadata.account_active === false;
}

interface FirstLoginCompletion {
  completed?: boolean;
  alreadyCompleted?: boolean;
  keyringReused?: boolean;
}

const FIRST_LOGIN_REAUTHENTICATION_MESSAGE = "PIN/비밀번호 설정은 완료되었습니다. 새 로그인 세션을 만들지 못했습니다. 다시 로그인해 주세요.";

export class FirstLoginReauthenticationError extends Error {
  constructor() {
    super(FIRST_LOGIN_REAUTHENTICATION_MESSAGE);
    this.name = "FirstLoginReauthenticationError";
  }
}

async function invokeFirstLoginCompletion(authCredential: string, record: UserKeyringRecord): Promise<FirstLoginCompletion> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const data = await invokeAuthenticatedFunction<FirstLoginCompletion>("complete-first-login", {
        body: {
          derivedCredential: authCredential,
          keyring: record
        },
        fallbackMessage: "최초 로그인 상태를 완료할 수 없습니다."
      });
      if (data.completed === true) return data;
    } catch (error) {
      if (
        error instanceof AuthenticatedFunctionError
        && (error.code.startsWith("AUTH_SESSION_") || error.status === 401)
      ) throw error;
      // 응답 유실도 부분 성공일 수 있으므로 같은 요청을 즉시 한 번 재시도한다.
    }
  }
  throw new Error("로그인 암호는 변경되었을 수 있지만 계정 초기 설정을 완료하지 못했습니다. 같은 PIN 또는 비밀번호로 초기 설정 완료를 다시 시도하세요.");
}

async function rebuildCompletedSession(
  userId: string,
  studentId: string,
  credential: string
): Promise<{ session: Session; user: User; profile: Profile; keyring: UnlockedUserKeyring }> {
  const authenticated = await reauthenticateAfterFirstLogin(
    supabase as unknown as FirstLoginAuthClient,
    studentId,
    userId,
    credential
  );
  const profile = await fetchProfile(userId);
  if (needsFirstLogin(authenticated.user, profile)) throw new Error("FIRST_LOGIN_REAUTHENTICATION_FAILED");
  const record = keyringRecord(profile);
  if (!record) throw new Error("FIRST_LOGIN_REAUTHENTICATION_FAILED");
  const keyring = await unlockUserKeyring(credential, record);
  await persistSessionKeyringWhenSupported(userId, keyring);
  return { session: authenticated.session, user: authenticated.user, profile, keyring };
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  initialized: false,
  keyringHydrated: false,
  loading: true,
  session: null,
  user: null,
  profile: null,
  keyring: null,
  error: null,

  initialize: async () => {
    set({ loading: true, initialized: false, keyringHydrated: false });
    await clearExpiredSessionKeyrings().catch(() => undefined);
    const { data } = await supabase.auth.getSession();
    try {
      const profile = data.session ? await fetchProfile(data.session.user.id) : null;
      if (data.session && profile && accountIsInactive(data.session.user, profile)) {
        await supabase.auth.signOut();
        await clearSessionKeyring(data.session.user.id);
        set({ initialized: true, keyringHydrated: true, loading: false, session: null, user: null, profile: null, keyring: null, error: "비활성화된 계정입니다." });
        return;
      }
      const keyring = data.session && profile && keyringRecord(profile)
        ? await restoreSessionKeyring(data.session.user.id)
        : null;
      set({ initialized: true, keyringHydrated: true, loading: false, session: data.session, user: data.session?.user ?? null, profile, keyring });
    } catch (error) {
      set({ initialized: true, keyringHydrated: true, loading: false, session: data.session, user: data.session?.user ?? null, keyring: null, error: errorMessage(error) });
    }
  },

  login: async (studentId, credential) => {
    set({ loading: true, error: null });
    try {
      const authCredential = await deriveAuthCredential(studentId, credential);
      const { data, error } = await supabase.auth.signInWithPassword({
        email: studentIdToInternalEmail(studentId),
        password: authCredential
      });
      if (error || !data.session || !data.user) throw new Error("학번 또는 비밀번호가 올바르지 않습니다.");
      let profile = await fetchProfile(data.user.id);
      if (accountIsInactive(data.user, profile)) throw new Error("비활성화된 계정입니다.");

      if (needsFirstLogin(data.user, profile)) {
        const existing = keyringRecord(profile);
        const keyring = existing ? await unlockUserKeyring(credential, existing) : null;
        if (keyring) await persistSessionKeyringWhenSupported(data.user.id, keyring);
        set({ loading: false, keyringHydrated: true, session: data.session, user: data.user, profile, keyring });
        recordAccessEventBestEffort("login");
        return "first-login";
      }

      let keyring: UnlockedUserKeyring;
      const existing = keyringRecord(profile);
      if (existing) {
        keyring = await unlockUserKeyring(credential, existing);
      } else {
        const created = await createUserKeyring(credential);
        await saveKeyring(data.user.id, created.record);
        profile = await fetchProfile(data.user.id);
        keyring = created.keyring;
      }
      await persistSessionKeyringWhenSupported(data.user.id, keyring);
      set({ loading: false, keyringHydrated: true, session: data.session, user: data.user, profile, keyring });
      recordAccessEventBestEffort("login");
      return "dashboard";
    } catch (error) {
      await supabase.auth.signOut().catch(() => undefined);
      set({ loading: false, session: null, user: null, profile: null, keyring: null, error: errorMessage(error) });
      throw error;
    }
  },

  completeFirstLogin: async (newCredential) => {
    const currentUser = get().user;
    const currentProfile = get().profile;
    if (!currentUser) throw new Error("로그인 세션이 없습니다.");
    if (!currentProfile) throw new Error("사용자 프로필을 불러올 수 없습니다.");
    if (currentProfile && keyringRecord(currentProfile) && !get().keyring) {
      throw new Error("기존 암호화 키를 먼저 잠금 해제해야 합니다. 로그아웃한 뒤 현재 비밀번호로 다시 로그인하세요.");
    }
    if (newCredential.length < 4) throw new Error("비밀번호는 4자 이상이어야 합니다.");
    set({ loading: true, error: null });
    try {
      const currentKeyring = get().keyring;
      const protectedKeyring = currentKeyring
        ? { record: await protectUnlockedUserKeyring(newCredential, currentKeyring), keyring: currentKeyring }
        : await createUserKeyring(newCredential);
      const authCredential = await deriveAuthCredential(currentProfile.student_id, newCredential);
      await invokeFirstLoginCompletion(authCredential, protectedKeyring.record);
      let rebuilt: Awaited<ReturnType<typeof rebuildCompletedSession>>;
      try {
        rebuilt = await rebuildCompletedSession(currentUser.id, currentProfile.student_id, newCredential);
      } catch {
        await clearSessionKeyring(currentUser.id);
        await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
        const reauthenticationError = new FirstLoginReauthenticationError();
        set({
          initialized: true,
          keyringHydrated: true,
          loading: false,
          session: null,
          user: null,
          profile: null,
          keyring: null,
          error: reauthenticationError.message
        });
        throw reauthenticationError;
      }
      set({
        initialized: true,
        keyringHydrated: true,
        loading: false,
        session: rebuilt.session,
        user: rebuilt.user,
        profile: rebuilt.profile,
        keyring: rebuilt.keyring,
        error: null
      });
      recordAccessEventBestEffort("password_changed");
    } catch (error) {
      set({ loading: false, error: errorMessage(error) });
      throw error;
    }
  },

  unlockKeyring: async (credential) => {
    const profile = get().profile;
    if (!profile) throw new Error("프로필을 찾을 수 없습니다. 다시 로그인해 주세요.");
    const record = profile ? keyringRecord(profile) : null;
    if (!record) throw new Error("보안 키가 설정되지 않았습니다. 다시 로그인해 주세요.");
    set({ loading: true, error: null });
    try {
      const keyring = await unlockUserKeyring(credential, record);
      await persistSessionKeyringWhenSupported(profile.id, keyring);
      set({ loading: false, keyringHydrated: true, keyring });
    } catch (error) {
      set({ loading: false, error: errorMessage(error) });
      throw error;
    }
  },

  refreshProfile: async () => {
    const userId = get().user?.id;
    if (!userId) return;
    set({ profile: await fetchProfile(userId) });
  },

  lockKeyring: async () => {
    const userId = get().user?.id ?? null;
    set({ keyring: null, keyringHydrated: true });
    await clearSessionKeyring(userId);
  },

  logout: async () => {
    const userId = get().user?.id ?? null;
    await recordAccessEvent("logout").catch(() => undefined);
    set({ keyring: null });
    await clearSessionKeyring(userId);
    await supabase.auth.signOut();
    set({ initialized: true, keyringHydrated: true, session: null, user: null, profile: null, keyring: null, error: null });
  },

  clearError: () => set({ error: null })
}));
