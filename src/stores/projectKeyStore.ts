import { create } from "zustand";
import { forgetProjectKey, unwrapProjectKey } from "../crypto";
import { supabase } from "../lib/supabase";
import { useAuthStore } from "./authStore";

interface ProjectKeyStore {
  keys: Map<string, CryptoKey>;
  unlocking: string | null;
  remember: (projectId: string, key: CryptoKey) => void;
  get: (projectId: string) => CryptoKey | null;
  unlock: (projectId: string) => Promise<CryptoKey>;
  forget: (projectId: string) => void;
  forgetAll: () => void;
}

export const useProjectKeyStore = create<ProjectKeyStore>((set, get) => ({
  keys: new Map(),
  unlocking: null,

  remember: (projectId, key) => set((state) => ({ keys: new Map(state.keys).set(projectId, key) })),
  get: (projectId) => get().keys.get(projectId) ?? null,

  unlock: async (projectId) => {
    const existing = get().keys.get(projectId);
    if (existing) return existing;
    const { user, keyring } = useAuthStore.getState();
    if (!user || !keyring) throw new Error("먼저 사용자 keyring을 잠금 해제하세요.");
    set({ unlocking: projectId });
    try {
      const { data, error } = await supabase.from("project_keys")
        .select("wrapped_key, ephemeral_public_key")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .single();
      if (error || !data) throw new Error("이 프로젝트의 암호화 키에 접근할 수 없습니다.");
      const key = await unwrapProjectKey(data, keyring, projectId, user.id);
      get().remember(projectId, key);
      return key;
    } finally {
      set({ unlocking: null });
    }
  },

  forget: (projectId) => {
    const next = new Map(get().keys);
    const key = next.get(projectId);
    if (key) forgetProjectKey(key);
    next.delete(projectId);
    set({ keys: next });
  },

  forgetAll: () => {
    for (const key of get().keys.values()) forgetProjectKey(key);
    set({ keys: new Map() });
  }
}));
