import { describe, expect, it } from "vitest";
import appShell from "./AppShell.tsx?raw";
import projectPages from "../pages/ProjectPages.tsx?raw";

describe("global Team Rocket Dashboard links", () => {
  it("wraps both the sidebar R logo and Team Rocket label in a Dashboard Link", () => {
    const sidebarBrand = appShell.match(/<Link\s+to="\/dashboard"\s+aria-label="Team Rocket 대시보드"[\s\S]*?<\/Link>/u)?.[0] ?? "";
    expect(sidebarBrand).toContain(">\n          R\n");
    expect(sidebarBrand).toContain("Team Rocket");
  });

  it("links the global breadcrumb brand while keeping the project name outside it", () => {
    const breadcrumb = appShell.match(/<Link\s+to="\/dashboard"\s+aria-label="Team Rocket 대시보드 breadcrumb"[\s\S]*?<\/Link>/u)?.[0] ?? "";
    expect(breadcrumb).toContain(">R</span>");
    expect(breadcrumb).toContain("<span>Team Rocket</span>");
    expect(breadcrumb).not.toContain("currentProject.data.name");
    expect(appShell.indexOf("currentProject.data.name")).toBeGreaterThan(appShell.indexOf(breadcrumb));
  });

  it("keeps the project workspace header as project information, not a Dashboard link", () => {
    const header = projectPages.match(/<div className="flex min-w-0 items-center gap-3">[\s\S]*?Team Rocket 프로젝트 워크스페이스[\s\S]*?<\/div>\s*<div className="flex shrink-0/u)?.[0] ?? "";
    expect(header).toContain("project.data.name");
    expect(header).not.toContain('to="/dashboard"');
  });
});
