import { describe, expect, it } from "vitest";
import app from "../App.tsx?raw";
import appShell from "../components/AppShell.tsx?raw";
import newProjectDialog from "../components/NewProjectDialog.tsx?raw";
import dashboard from "../pages/DashboardPage.tsx?raw";
import projectPages from "../pages/ProjectPages.tsx?raw";
import secondaryPages from "../pages/ProjectSecondaryPages.tsx?raw";
import activityService from "../services/activity.ts?raw";
import fileService from "../services/files.ts?raw";
import createProject from "../../supabase/functions/create-project/index.ts?raw";
import githubStatus from "../../supabase/functions/github-repository-status/index.ts?raw";
import notificationTypesMigration from "../../supabase/migrations/202608220013_enhance_project_notification_types.sql?raw";
import notificationsMigration from "../../supabase/migrations/202608220016_materialize_project_notifications.sql?raw";
import foldersMigration from "../../supabase/migrations/202608220014_virtual_file_folders.sql?raw";
import projectGitHubMigration from "../../supabase/migrations/202608220015_decouple_project_github_status.sql?raw";

describe("Team Rocket product direction", () => {
  it("uses Team Rocket branding and removes the top-level GitHub route", () => {
    expect(appShell).toContain("Team Rocket");
    expect(dashboard).toContain('eyebrow="Team Rocket"');
    expect(projectPages).not.toContain('path: "github"');
    expect(app).not.toContain('path="github"');
  });

  it("keeps GitHub as an owner-only settings integration with recent commits", () => {
    expect(secondaryPages).toContain("GitHubIntegrationSection");
    expect(secondaryPages).toContain('role === "owner"');
    expect(secondaryPages).toContain("최근 커밋");
    expect(secondaryPages).toContain("GitHub에서 열기");
    expect(githubStatus).toContain("listRecentCommits");
    expect(githubStatus).toContain("commits");
  });

  it("creates a usable project even when GitHub is skipped or fails", () => {
    expect(newProjectDialog).toContain("createRepository");
    expect(newProjectDialog).toContain("선택하지 않아도 프로젝트의 모든 업무 기능");
    expect(createProject).toContain('rpc("finalize_project_without_repository"');
    expect(createProject).toContain('rpc("mark_project_github_error"');
    expect(createProject).toContain("integrationWarning");
    expect(projectGitHubMigration).toContain("status = 'active'");
    expect(projectGitHubMigration).toContain("github_sync_status = 'not_connected'");
  });

  it("turns Overview into a project dashboard", () => {
    for (const label of ["프로젝트 진행률", "전체 작업", "내 작업", "마감 임박", "최근 활동", "팀 현황"]) {
      expect(projectPages).toContain(label);
    }
    expect(projectPages).toContain("overdue");
    expect(projectPages).toContain("listActivities");
    expect(projectPages).toContain("task_assignees");
  });

  it("provides an unread notification center with read-all and contextual navigation", () => {
    expect(appShell).toContain("markAllNotificationsRead");
    expect(appShell).toContain("file_uploaded");
    expect(activityService).toContain('rpc("refresh_due_notifications")');
    expect(activityService).toContain("markAllNotificationsRead");
    for (const type of ["task_updated", "comment_added", "file_uploaded", "overdue"]) {
      expect(notificationTypesMigration).toContain(`'${type}'`);
    }
    expect(notificationsMigration).toContain("refresh_due_notifications");
    expect(notificationsMigration).toContain("record_file_activity");
  });

  it("keeps file bytes encrypted while adding search, filters and virtual folders", () => {
    expect(fileService).toContain("encryptFile(file, key");
    expect(fileService).toContain('contentType: "application/octet-stream"');
    expect(fileService).toContain("createFileFolder");
    expect(fileService).toContain("moveProjectFile");
    for (const label of ["파일 이름 검색", "이름순", "모든 업로더", "모든 유형", "연결된 작업"]) {
      expect(secondaryPages).toContain(label);
    }
    expect(foldersMigration).toContain("create table public.file_folders");
    expect(foldersMigration).toContain("folder_id uuid");
  });

});
