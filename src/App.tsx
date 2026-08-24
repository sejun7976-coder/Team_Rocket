import { useEffect, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  HashRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { Spinner } from "./components/ui";
import {
  canEnterBusinessRoutes,
  isSystemAdmin,
  needsFirstLogin,
} from "./lib/authPolicy";
import {
  AdminProjectsPage,
  AdminSystemPage,
  AdminUsersPage,
} from "./pages/AdminPages";
import { FirstLoginPage, LoginPage, UnlockPage } from "./pages/AuthPages";
import { DashboardPage, ProjectsPage } from "./pages/DashboardPage";
import {
  GlobalActivityPage,
  GlobalCalendarPage,
  MyTasksPage,
  NotificationsPage,
  SettingsPage,
} from "./pages/GlobalPages";
import {
  BoardPage,
  ProjectLayoutPage,
  ProjectOverviewPage,
  TaskListPage,
} from "./pages/ProjectPages";
import {
  ProjectActivityPage,
  ProjectCalendarPage,
  ProjectFilesPage,
  ProjectSettingsPage,
  ProjectTeamPage,
} from "./pages/ProjectSecondaryPages";
import { TaskPage } from "./pages/TaskPage";
import { AdminAISettingsPage } from "./pages/AdminAISettingsPage";
import { AdminAILogsPage } from "./pages/AdminAILogsPage";
import { useAuthStore } from "./stores/authStore";
import { useProjectKeyStore } from "./stores/projectKeyStore";
import { supabase } from "./lib/supabase";
import type { Profile } from "./types/domain";
import { usePermissions } from "./hooks/usePermissions";
import {
  ADMIN_PERMISSIONS,
  type Permission,
} from "../supabase/functions/_shared/adminPermissions";

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <Spinner />
    </div>
  );
}

function ProtectedLayout() {
  const { initialized, keyringHydrated, loading, user, profile, keyring } =
    useAuthStore();
  const location = useLocation();
  if (!initialized || !keyringHydrated || loading) return <LoadingScreen />;
  if (!user)
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (needsFirstLogin(user, profile))
    return <Navigate to="/first-login" replace />;
  if (!canEnterBusinessRoutes(user, profile))
    return <Navigate to="/login" replace />;
  if (!keyring) return <Navigate to="/unlock" replace />;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function PermissionGuard({ permission }: { permission: Permission }) {
  const permissions = usePermissions();
  if (permissions.isLoading) return <LoadingScreen />;
  return permissions.has(permission)
    ? <Outlet />
    : <Navigate to="/dashboard" replace />;
}

function SystemAdminPermissionGuard({ permission }: { permission: Permission }) {
  const { user, profile } = useAuthStore();
  const permissions = usePermissions();
  if (permissions.isLoading) return <LoadingScreen />;
  return isSystemAdmin(user, profile) && permissions.has(permission)
    ? <Outlet />
    : <Navigate to="/dashboard" replace />;
}

function Bootstrap({ children }: { children: ReactNode }) {
  const initialize = useAuthStore((state) => state.initialize);
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const forgetAll = useProjectKeyStore((state) => state.forgetAll);
  const queryClient = useQueryClient();
  useEffect(() => {
    void initialize();
  }, [initialize]);
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`account-status:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${user.id}`,
        },
        (payload) => {
          const updated = payload.new as Profile;
          if (updated.account_status === "active") return;
          forgetAll();
          queryClient.clear();
          void logout().finally(() => {
            window.location.hash = "#/login";
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [forgetAll, logout, queryClient, user]);
  return children;
}

export function App() {
  return (
    <HashRouter>
      <Bootstrap>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/first-login" element={<FirstLoginPage />} />
          <Route path="/unlock" element={<UnlockPage />} />
          <Route element={<ProtectedLayout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/:projectId" element={<ProjectLayoutPage />}>
              <Route index element={<ProjectOverviewPage />} />
              <Route path="board" element={<BoardPage />} />
              <Route path="tasks" element={<TaskListPage />} />
              <Route path="calendar" element={<ProjectCalendarPage />} />
              <Route path="files" element={<ProjectFilesPage />} />
              <Route path="activity" element={<ProjectActivityPage />} />
              <Route path="team" element={<ProjectTeamPage />} />
              <Route path="settings" element={<ProjectSettingsPage />} />
            </Route>
            <Route path="tasks/:taskId" element={<TaskPage />} />
            <Route path="my-tasks" element={<MyTasksPage />} />
            <Route path="calendar" element={<GlobalCalendarPage />} />
            <Route path="activity" element={<GlobalActivityPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route element={<PermissionGuard permission={ADMIN_PERMISSIONS.USERS_VIEW} />}>
              <Route path="admin/users" element={<AdminUsersPage />} />
            </Route>
            <Route element={<PermissionGuard permission={ADMIN_PERMISSIONS.PROJECTS_VIEW} />}>
              <Route path="admin/projects" element={<AdminProjectsPage />} />
            </Route>
            <Route element={<PermissionGuard permission={ADMIN_PERMISSIONS.USERS_MANAGE_PERMISSIONS} />}>
              <Route path="admin/system" element={<AdminSystemPage />} />
            </Route>
            <Route element={<PermissionGuard permission={ADMIN_PERMISSIONS.AI_MANAGE} />}>
              <Route path="admin/ai" element={<AdminAISettingsPage />} />
            </Route>
            <Route element={<SystemAdminPermissionGuard permission={ADMIN_PERMISSIONS.AI_LOGS_VIEW} />}>
              <Route path="admin/ai-logs" element={<AdminAILogsPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Bootstrap>
    </HashRouter>
  );
}
