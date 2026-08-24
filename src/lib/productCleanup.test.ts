import { describe, expect, it } from "vitest";
import app from "../App.tsx?raw";
import appShell from "../components/AppShell.tsx?raw";
import adminPages from "../pages/AdminPages.tsx?raw";
import projectPages from "../pages/ProjectPages.tsx?raw";
import secondaryPages from "../pages/ProjectSecondaryPages.tsx?raw";
import aiPanel from "../components/RocketAIPanel.tsx?raw";
import aiService from "../services/ai.ts?raw";
import aiChat from "../../supabase/functions/ai-chat/index.ts?raw";

const frontendSources = import.meta.glob<string>(
  ["../**/*.ts", "../**/*.tsx", "!../lib/*.test.ts", "!../test/**"],
  { eager: true, query: "?raw", import: "default" },
);
const edgeFunctionSources = import.meta.glob<string>(
  "../../supabase/functions/**/index.ts",
  { eager: true, query: "?raw", import: "default" },
);

describe("Team Rocket focused product surface", () => {
  it("adds the current permission-gated AI implementation without reviving provider-specific clients", () => {
    const frontend = Object.values(frontendSources).join("\n");
    const edgePaths = Object.keys(edgeFunctionSources).join("\n");
    expect(frontend).toContain("RocketAIPanel");
    expect(edgePaths).toContain("ai-chat");
    expect(edgePaths).toContain("ai-models");
    expect(edgePaths).toContain("admin-ai-settings");
    expect(app).toContain("admin/ai");
    expect(appShell).toContain("RocketAIPanel");
    expect(aiPanel).toContain("실행 전 확인");
    expect(aiService).toContain("invokeAuthenticatedFunction");
    expect(aiChat).toContain("ADMIN_PERMISSIONS.AI_USE");
    expect(frontend).not.toMatch(/VITE_(?:OPENAI|ANTHROPIC|GOOGLE|AI).*KEY/u);
    expect(adminPages).not.toContain("OpenAI API Key");
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
