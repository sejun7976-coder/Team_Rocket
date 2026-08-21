import type { Session, User } from "@supabase/supabase-js";
import { create } from "zustand";
import {
  createUserKeyring,
  protectUnlockedUserKeyring,
  unlockUserKeyring,
  type UnlockedUserKeyring,
  type UserKeyringRecord
} from "../crypto";
import { deriveAuthCredential } from "../../supabase/functions/_shared/authCredential";
import { needsFirstLogin } from "../lib/authPolicy";
import { supabase } from "../lib/supabase";
import { studentIdToInternalEmail } from "../lib/utils";
import type { Profile } from "../types/domain";

export type LoginDestination = "first-login" | "dashboard";

interface AuthStore {
  initialized: boolean;
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
  lockKeyring: () => void;
  logout: () => Promise<void>;
  clearError: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 처리할 수 없습니다.";
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
  if (error) throw new Error("사용자 암호화 keyring을 저장할 수 없습니다.");
}

function accountIsInactive(user: User, profile: Profile): boolean {
  return profile.account_status === "inactive" || user.app_metadata.account_active === false;
}

interface FirstLoginCompletion {
  completed?: boolean;
  alreadyCompleted?: boolean;
  keyringReused?: boolean;
}

async function invokeFirstLoginCompletion(authCredential: string, record: UserKeyringRecord): Promise<FirstLoginCompletion> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data, error } = await supabase.functions.invoke<FirstLoginCompletion>("complete-first-login", {
        body: {
          derivedCredential: authCredential,
          keyring: record
        }
      });
      if (!error && data?.completed === true) return data;
    } catch {
      // 응답 유실도 부분 성공일 수 있으므로 같은 요청을 즉시 한 번 재시도한다.
    }
  }
  throw new Error("로그인 암호는 변경되었을 수 있지만 계정 초기 설정을 완료하지 못했습니다. 같은 PIN 또는 비밀번호로 초기 설정 완료를 다시 시도하세요.");
}

async function rebuildCompletedSession(
  userId: string,
  credential: string
): Promise<{ session: Session; user: User; profile: Profile; keyring: UnlockedUserKeyring }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshed.session) continue;

      const { data: verified, error: userError } = await supabase.auth.getUser();
      if (userError || !verified.user || verified.user.id !== userId) continue;

      const profile = await fetchProfile(userId);
      if (needsFirstLogin(verified.user, profile)) continue;
      const record = keyringRecord(profile);
      if (!record) continue;
      const keyring = await unlockUserKeyring(credential, record);
      return {
        session: { ...refreshed.session, user: verified.user },
        user: verified.user,
        profile,
        keyring
      };
    } catch {
      // 즉시 한 번 더 refresh/getUser/profile을 검증한다. 지연 시간에 의존하지 않는다.
    }
  }
  throw new Error("계정 초기 설정은 완료되었지만 로그인 세션을 갱신할 수 없습니다. 로그아웃한 뒤 새 PIN 또는 비밀번호로 다시 로그인하세요.");
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  initialized: false,
  loading: true,
  session: null,
  user: null,
  profile: null,
  keyring: null,
  error: null,

  initialize: async () => {
    set({ loading: true });
    const { data } = await supabase.auth.getSession();
    try {
      const profile = data.session ? await fetchProfile(data.session.user.id) : null;
      if (data.session && profile && accountIsInactive(data.session.user, profile)) {
        await supabase.auth.signOut();
        set({ initialized: true, loading: false, session: null, user: null, profile: null, keyring: null, error: "비활성화된 계정입니다." });
        return;
      }
      set({ initialized: true, loading: false, session: data.session, user: data.session?.user ?? null, profile, keyring: null });
    } catch (error) {
      set({ initialized: true, loading: false, session: data.session, user: data.session?.user ?? null, error: errorMessage(error) });
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
        set({ loading: false, session: data.session, user: data.user, profile, keyring });
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
      set({ loading: false, session: data.session, user: data.user, profile, keyring });
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
      const rebuilt = await rebuildCompletedSession(currentUser.id, newCredential);
      set({
        initialized: true,
        loading: false,
        session: rebuilt.session,
        user: rebuilt.user,
        profile: rebuilt.profile,
        keyring: rebuilt.keyring,
        error: null
      });
    } catch (error) {
      set({ loading: false, error: errorMessage(error) });
      throw error;
    }
  },

  unlockKeyring: async (credential) => {
    const profile = get().profile;
    const record = profile ? keyringRecord(profile) : null;
    if (!record) throw new Error("암호화 keyring이 설정되지 않았습니다. 다시 로그인해 주세요.");
    set({ loading: true, error: null });
    try {
      const keyring = await unlockUserKeyring(credential, record);
      set({ loading: false, keyring });
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

  lockKeyring: () => set({ keyring: null }),

  logout: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null, profile: null, keyring: null, error: null });
  },

  clearError: () => set({ error: null })
}));
