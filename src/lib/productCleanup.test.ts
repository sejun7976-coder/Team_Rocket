import { describe, expect, it } from "vitest";
import app from "../App.tsx?raw";
import appShell from "../components/AppShell.tsx?raw";
import adminPages from "../pages/AdminPages.tsx?raw";
import projectPages from "../pages/ProjectPages.tsx?raw";
import secondaryPages from "../pages/ProjectSecondaryPages.tsx?raw";

const frontendSources = import.meta.glob<string>(
  ["../**/*.ts", "../**/*.tsx", "!../lib/*.test.ts", "!../test/**"],
  { eager: true, query: "?raw", import: "default" },
);
const edgeFunctionSources = import.meta.glob<string>(
  "../../supabase/functions/**/index.ts",
  { eager: true, query: "?raw", import: "default" },
);

describe("Team Rocket product cleanup", () => {
  it("removes every AI runtime route, component, request and Edge Function", () => {
    const frontend = Object.values(frontendSources).join("\n");
    const edgePaths = Object.keys(edgeFunctionSources).join("\n");
    for (const removed of [
      "RocketAIPanel",
      "Rocket AI",
      "ai-assistant",
      "ai-models",
      "admin-ai-settings",
      "modelSettingId",
    ]) {
      expect(frontend).not.toContain(removed);
      expect(edgePaths).not.toContain(removed);
    }
    expect(app).not.toContain("admin/ai");
    expect(appShell).not.toContain("Sparkles");
    expect(adminPages).not.toContain("AI 설정");
  });

  it("uses the final Korean navigation and focused integration copy", () => {
    for (const label of ["개요", "보드", "작업", "캘린더", "파일", "활동", "팀", "설정"]) {
      expect(projectPages).toContain(`"${label}"`);
    }
    expect(secondaryPages).toContain("GitHub 저장소");
    expect(secondaryPages).toContain("프로젝트의 소스 코드 저장소를 연결합니다.");
    expect(secondaryPages).not.toContain("Repository marker");
  });
});
