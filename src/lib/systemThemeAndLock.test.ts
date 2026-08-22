import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import appShellSource from "../components/AppShell.tsx?raw";
import authPagesSource from "../pages/AuthPages.tsx?raw";
import settingsSource from "../pages/GlobalPages.tsx?raw";
import tailwindSource from "../../tailwind.config.js?raw";
import indexSource from "../../index.html?raw";
import earlyThemeSource from "../../public/theme-init.js?raw";
import {
  applyThemePreference,
  initializeThemePreference,
  nextThemePreference,
  readThemePreference,
  THEME_STORAGE_KEY,
  useThemeStore
} from "../stores/themeStore";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

afterEach(() => {
  localStorage.removeItem(THEME_STORAGE_KEY);
  useThemeStore.setState({ preference: "system" });
  vi.unstubAllGlobals();
});

describe("theme preference and automatic key-lock UX", () => {
  it("defaults missing or invalid saved values to system", () => {
    expect(readThemePreference(null)).toBe("system");
    expect(readThemePreference({ getItem: () => "invalid" })).toBe("system");
    expect(readThemePreference({ getItem: () => "light" })).toBe("light");
    expect(readThemePreference({ getItem: () => "dark" })).toBe("dark");
  });

  it("resolves system, light, and dark onto the root element", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    applyThemePreference("system");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themePreference).toBe("system");
    applyThemePreference("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    applyThemePreference("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("updates System mode in real time when the OS theme changes", () => {
    let dark = false;
    let onChange: (() => void) | undefined;
    const removeEventListener = vi.fn();
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      get matches() { return dark; },
      addEventListener: (_type: string, listener: () => void) => { onChange = listener; },
      removeEventListener
    })));
    useThemeStore.setState({ preference: "system" });
    const cleanup = initializeThemePreference();
    expect(document.documentElement.dataset.theme).toBe("light");
    dark = true;
    onChange?.();
    expect(document.documentElement.dataset.theme).toBe("dark");
    cleanup();
    expect(removeEventListener).toHaveBeenCalledOnce();
  });

  it("applies the saved theme before the application module to prevent a flash", () => {
    expect(indexSource.indexOf("theme-init.js")).toBeLessThan(indexSource.indexOf("/src/main.tsx"));
    expect(earlyThemeSource).toContain("localStorage.getItem(key)");
    expect(earlyThemeSource).toContain('matchMedia("(prefers-color-scheme: dark)")');
    expect(earlyThemeSource).toContain("document.documentElement.dataset.theme");
    expect(styles).toContain(':root[data-theme="dark"]');
    expect(styles).toContain(":root:not([data-theme])");
    expect(tailwindSource).toContain("darkMode: [\"selector\", '[data-theme=\"dark\"]']");
  });

  it("cycles System, Light, and Dark one click at a time without a select", () => {
    expect(nextThemePreference("system")).toBe("light");
    expect(nextThemePreference("light")).toBe("dark");
    expect(nextThemePreference("dark")).toBe("system");
    expect(appShellSource).toContain("ThemeCycleButton");
    expect(settingsSource).toContain("ThemeCycleButton");
    expect(appShellSource).not.toContain('aria-label="테마"');
    expect(settingsSource).not.toContain('id="settings-theme"');
  });

  it("uses theme variables on login, first-login, unlock, settings, and modal surfaces", () => {
    expect(authPagesSource).not.toContain("bg-slate-950 p-10 text-white");
    expect(authPagesSource).toContain("border-line bg-raised");
    expect(authPagesSource).toContain("bg-canvas");
  });

  it("removes every manual lock control while retaining the 15-minute automatic lock", () => {
    expect(appShellSource).not.toContain("LockKeyhole");
    expect(appShellSource).not.toContain('aria-label="키 잠금"');
    expect(appShellSource).not.toContain("프로젝트 암호화 키를 잠급니다. 로그인 상태는 유지됩니다.");
    expect(appShellSource).toContain("KEYRING_INACTIVITY_TIMEOUT_MS");
    expect(appShellSource).toContain("await lockKeyring()");
    expect(appShellSource).toContain("KEYRING_INACTIVITY_TIMEOUT_MS");
    expect(settingsSource).not.toContain("사용자 keyring");
    expect(settingsSource).not.toContain("P-256 ECDH");
  });
});
