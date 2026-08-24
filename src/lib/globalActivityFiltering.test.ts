import { describe, expect, it } from "vitest";
import globalPagesSource from "../pages/GlobalPages.tsx?raw";
import projectPagesSource from "../pages/ProjectSecondaryPages.tsx?raw";
import activityServiceSource from "../services/activity.ts?raw";
import projectsServiceSource from "../services/projects.ts?raw";
import initialSchema from "../../supabase/migrations/202608220001_initial_schema.sql?raw";

describe("Global Activity project filtering", () => {
  it("loads only participating projects into the global project selector", () => {
    expect(globalPagesSource).toContain('queryKey: ["projects"]');
    expect(globalPagesSource).toContain("queryFn: listProjects");
    expect(globalPagesSource).toContain('<option value="">전체 활동</option>');
    expect(projectsServiceSource).toContain("project_members!inner");
    expect(initialSchema).toContain("create policy projects_select_member");
    expect(initialSchema).toContain("using (public.is_project_member(id))");
  });

  it("requests A only for A, B only for B, and omits the server filter for all activity", () => {
    expect(globalPagesSource).toContain('queryKey: ["activities", "global", projectId || "all"]');
    expect(globalPagesSource).toContain("listActivities(projectId || undefined)");
    expect(activityServiceSource).toContain('if (projectId) query = query.eq("project_id", projectId)');
  });

  it("keeps non-member activity protected by RLS and includes the project name", () => {
    expect(initialSchema).toContain("create policy activities_select_member");
    expect(initialSchema).toContain("using (public.is_project_member(project_id))");
    expect(activityServiceSource).toContain("project:projects!activities_project_id_fkey(id, name)");
    expect(globalPagesSource).toContain('item.project?.name ?? "프로젝트"');
  });

  it("keeps Project Activity scoped to its route project without a project selector", () => {
    const projectActivity = projectPagesSource.match(
      /export function ProjectActivityPage\(\)[\s\S]*?function AddMemberDialog/u,
    )?.[0] ?? "";
    expect(projectActivity).toContain("listProjectActivities(project.id)");
    expect(projectActivity).not.toContain("global-activity-project");
  });
});
