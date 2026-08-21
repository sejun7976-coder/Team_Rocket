import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import appShellSource from "../components/AppShell.tsx?raw";
import authPagesSource from "../pages/AuthPages.tsx?raw";
import settingsSource from "../pages/GlobalPages.tsx?raw";
import tailwindSource from "../../tailwind.config.js?raw";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("system theme and key-lock UX", () => {
  it("lets CSS follow live OS color-scheme changes from the initial paint", () => {
    expect(styles).toContain("@media (prefers-color-scheme: dark)");
    expect(styles).toMatch(/@media \(prefers-color-scheme: dark\)[\s\S]*?:root\s*\{/u);
    expect(styles).not.toMatch(/\.dark\s*\{/u);
    expect(tailwindSource).toContain('darkMode: "media"');
    expect(appShellSource).not.toContain("rocket-theme");
    expect(appShellSource).not.toContain("classList.toggle");
    expect(appShellSource).not.toContain("테마 변경");
  });

  it("uses theme variables on login, first-login, unlock, settings, and modal surfaces", () => {
    expect(authPagesSource).not.toContain("bg-slate-950 p-10 text-white");
    expect(authPagesSource).toContain("border-line bg-raised");
    expect(authPagesSource).toContain("bg-canvas");
    expect(settingsSource).toContain("시스템 설정 따름");
  });

  it("locks only memory-held keys and retains the authenticated session", () => {
    const lockBody = appShellSource.match(/const lock = \(\) => \{([^}]+)\}/u)?.[1] ?? "";
    expect(lockBody).toContain("forgetAll()");
    expect(lockBody).toContain("lockKeyring()");
    expect(lockBody).toContain('navigate("/unlock")');
    expect(lockBody).not.toContain("logout");
    expect(appShellSource).toContain("키 잠금");
    expect(appShellSource).toContain("프로젝트 암호화 키를 잠급니다. 로그인 상태는 유지됩니다.");
    expect(authPagesSource).toContain("로그아웃된 것이 아닙니다. 암호화 키만 잠겼습니다.");
    expect(settingsSource).toContain("자동 키 잠금");
  });
});
