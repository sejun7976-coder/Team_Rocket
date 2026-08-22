import { create } from "zustand";

interface RocketAIStore {
  opened: boolean;
  open: () => void;
  close: () => void;
}

export const useRocketAIStore = create<RocketAIStore>((set) => ({
  opened: false,
  open: () => set({ opened: true }),
  close: () => set({ opened: false })
}));
