import { create } from "zustand";

interface RocketAIStore {
  opened: boolean;
  minimized: boolean;
  open: () => void;
  close: () => void;
  minimize: () => void;
}

export const useRocketAIStore = create<RocketAIStore>((set) => ({
  opened: false,
  minimized: false,
  open: () => set({ opened: true, minimized: false }),
  close: () => set({ opened: false, minimized: false }),
  minimize: () => set({ minimized: true })
}));
