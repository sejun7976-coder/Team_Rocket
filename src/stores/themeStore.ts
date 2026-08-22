import { create } from "zustand";

export type ThemePreference = "system" | "light" | "dark";
export const THEME_STORAGE_KEY = "rocket-theme";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function readThemePreference(storage: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined" ? null : localStorage): ThemePreference {
  try {
    const stored = storage?.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function systemIsDark(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyThemePreference(preference: ThemePreference): void {
  if (typeof document === "undefined") return;
  const resolved = preference === "system" ? (systemIsDark() ? "dark" : "light") : preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = preference;
}

interface ThemeStore {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

const initialPreference = readThemePreference();

export const useThemeStore = create<ThemeStore>((set) => ({
  preference: initialPreference,
  setPreference: (preference) => {
    try { localStorage.setItem(THEME_STORAGE_KEY, preference); } catch { /* theme still applies for this page */ }
    applyThemePreference(preference);
    set({ preference });
  }
}));

export function initializeThemePreference(): () => void {
  applyThemePreference(useThemeStore.getState().preference);
  const media = matchMedia("(prefers-color-scheme: dark)");
  const onSystemChange = () => {
    if (useThemeStore.getState().preference === "system") applyThemePreference("system");
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    const preference = isThemePreference(event.newValue) ? event.newValue : "system";
    applyThemePreference(preference);
    useThemeStore.setState({ preference });
  };
  media.addEventListener("change", onSystemChange);
  window.addEventListener("storage", onStorage);
  return () => {
    media.removeEventListener("change", onSystemChange);
    window.removeEventListener("storage", onStorage);
  };
}
