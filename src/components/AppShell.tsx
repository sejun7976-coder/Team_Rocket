import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Bell,
  Bot,
  CalendarDays,
  CheckSquare,
  FolderCog,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  Settings,
  Shield,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { isSystemAdmin } from "../lib/authPolicy";
import { usePermissions } from "../hooks/usePermissions";
import { ADMIN_PERMISSIONS } from "../../supabase/functions/_shared/adminPermissions";
import { cn } from "../lib/utils";
import { formatRelativeTime } from "../lib/display";
import {
  KEYRING_INACTIVITY_TIMEOUT_MS,
  readLastActivityAt,
  touchSessionKeyring,
  writeLastActivityAt,
} from "../crypto";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../services/activity";
import { getProject } from "../services/projects";
import { useAuthStore } from "../stores/authStore";
import { useProjectKeyStore } from "../stores/projectKeyStore";
import { Avatar, Badge, Button, Popover } from "./ui";
import { ThemeCycleButton } from "./ThemeCycleButton";
import { RocketAIPanel } from "./RocketAIPanel";

const nav = [
  ["/dashboard", "대시보드", LayoutDashboard],
  ["/projects", "내 프로젝트", FolderKanban],
  ["/my-tasks", "내 작업", CheckSquare],
  ["/calendar", "일정", CalendarDays],
  ["/activity", "활동", Activity],
] as const;

const adminNav = [
  { to: "/admin/users", label: "사용자 관리", Icon: Users, permission: ADMIN_PERMISSIONS.USERS_VIEW, systemAdminOnly: false },
  { to: "/admin/projects", label: "프로젝트 관리", Icon: FolderCog, permission: ADMIN_PERMISSIONS.PROJECTS_VIEW, systemAdminOnly: false },
  { to: "/admin/ai", label: "AI 설정", Icon: Bot, permission: ADMIN_PERMISSIONS.AI_MANAGE, systemAdminOnly: false },
  { to: "/admin/ai-logs", label: "AI 대화 기록", Icon: ScrollText, permission: ADMIN_PERMISSIONS.AI_LOGS_VIEW, systemAdminOnly: true },
  { to: "/admin/system", label: "시스템 설정", Icon: SlidersHorizontal, permission: ADMIN_PERMISSIONS.USERS_MANAGE_PERMISSIONS, systemAdminOnly: false },
] as const;

function NavigationLink({
  to,
  label,
  Icon,
}: {
  to: string;
  label: string;
  Icon: typeof LayoutDashboard;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "nav-item flex items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-sm font-medium transition",
          isActive
            ? "nav-item-active text-brand"
            : "text-muted hover:border-line/60 hover:bg-raised/70 hover:text-ink",
        )
      }
    >
      <Icon size={18} />
      {label}
    </NavLink>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, profile, logout, lockKeyring } = useAuthStore();
  const admin = isSystemAdmin(user, profile);
  const permissions = usePermissions();
  const forgetAll = useProjectKeyStore((state) => state.forgetAll);
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const queryClient = useQueryClient();
  const routeProjectId = location.pathname.match(/^\/projects\/([0-9a-f-]{36})(?:\/|$)/iu)?.[1] ?? "";
  const currentProject = useQuery({
    queryKey: ["project", routeProjectId],
    queryFn: () => getProject(routeProjectId),
    enabled: Boolean(routeProjectId),
  });
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: listNotifications,
    refetchInterval: 60_000,
  });
  const unread =
    notifications.data?.filter((item) => !item.read_at).length ?? 0;
  const openNotification = async (
    notification: NonNullable<typeof notifications.data>[number],
    close: () => void,
  ) => {
    if (!notification.read_at) await markNotificationRead(notification.id);
    close();
    await queryClient.invalidateQueries({ queryKey: ["notifications"] });
    navigate(
      notification.task_id
        ? `/tasks/${notification.task_id}`
        : notification.type === "file_uploaded" && notification.project_id
          ? `/projects/${notification.project_id}/files`
        : notification.project_id
          ? `/projects/${notification.project_id}`
          : "/notifications",
    );
  };
  const markAllRead = async () => {
    await markAllNotificationsRead();
    await queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!user) return;
    let lastActivity = readLastActivityAt() ?? Date.now();
    let lastPersistentTouch = lastActivity;
    let locking = false;
    writeLastActivityAt(lastActivity);
    const mark = () => {
      const now = Date.now();
      lastActivity = now;
      writeLastActivityAt(now);
      if (now - lastPersistentTouch >= 30_000) {
        lastPersistentTouch = now;
        void touchSessionKeyring(user.id, now);
      }
    };
    const lockIfExpired = async () => {
      if (locking || Date.now() - lastActivity < KEYRING_INACTIVITY_TIMEOUT_MS)
        return;
      locking = true;
      forgetAll();
      await lockKeyring();
      navigate("/unlock", { replace: true });
    };
    const interval = window.setInterval(() => {
      void lockIfExpired();
    }, 5_000);
    void lockIfExpired();
    ["pointerdown", "keydown", "touchstart", "scroll"].forEach((event) =>
      window.addEventListener(event, mark, { passive: true }),
    );
    return () => {
      window.clearInterval(interval);
      ["pointerdown", "keydown", "touchstart", "scroll"].forEach((event) =>
        window.removeEventListener(event, mark),
      );
    };
  }, [forgetAll, lockKeyring, navigate, user]);

  const signOut = async () => {
    forgetAll();
    await logout();
    navigate("/login", { replace: true });
  };
  const sidebar = (
    <aside className="app-sidebar-shell flex h-full w-[250px] flex-col overflow-hidden">
      <Link
        to="/dashboard"
        aria-label="Team Rocket 대시보드"
        className="group flex h-[68px] items-center gap-3 border-b border-line/70 px-4 transition hover:bg-raised/60 focus-visible:bg-raised/60"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/20 bg-brand font-black text-white shadow-md shadow-brand/20 transition group-hover:-translate-y-px">
          R
        </span>
        <span>
          <span className="block text-sm font-extrabold tracking-tight text-ink">
            Team Rocket
          </span>
          <span className="block text-[9px] font-bold uppercase tracking-[.16em] text-muted">
            프로젝트 관리
          </span>
        </span>
      </Link>
      <nav className="scrollbar-thin flex-1 space-y-1 overflow-y-auto p-3.5">
        {nav.map(([to, label, Icon]) => (
          <NavigationLink key={to} to={to} label={label} Icon={Icon} />
        ))}
        {adminNav.some((item) => permissions.has(item.permission) && (!item.systemAdminOnly || admin)) && (
          <div className="mt-5 border-t border-line pt-4">
            <div className="mb-2 flex items-center gap-2 px-3 text-[10px] font-black uppercase tracking-[.14em] text-muted">
              <Shield size={13} /> 관리
            </div>
            {adminNav
              .filter((item) => permissions.has(item.permission) && (!item.systemAdminOnly || admin))
              .map(({ to, label, Icon }) => (
                <NavigationLink key={to} to={to} label={label} Icon={Icon} />
              ))}
          </div>
        )}
      </nav>
      <div className="border-t border-line/70 p-3">
        <Link to="/settings" className="mb-2 flex items-center gap-3 rounded-xl border border-transparent px-2.5 py-2 transition hover:border-line/60 hover:bg-raised/70">
          <Avatar name={profile?.name ?? "사용자"} url={profile?.avatar_url} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-bold text-ink">{profile?.name ?? "사용자"}</span>
            <span className="block truncate text-[10px] text-muted">{profile?.student_id ?? "내 계정"}</span>
          </span>
        </Link>
        <NavigationLink to="/settings" label="설정" Icon={Settings} />
        <button
          onClick={() => void signOut()}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted hover:bg-red-500/10 hover:text-red-600"
        >
          <LogOut size={18} />
          로그아웃
        </button>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen">
      <div className="layer-navigation fixed inset-y-0 left-0 hidden p-3 lg:block">
        {sidebar}
      </div>
      {mobileOpen && (
        <div className="layer-navigation fixed inset-0 lg:hidden">
          <button
            aria-label="메뉴 닫기"
            className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative h-full w-[274px] p-3">
            {sidebar}
            <Button
              variant="ghost"
               className="absolute right-5 top-5 h-8 w-8 p-0"
              aria-label="메뉴 닫기"
              title="닫기"
              onClick={() => setMobileOpen(false)}
            >
              <X size={18} />
            </Button>
          </div>
        </div>
      )}
      <div className="lg:pl-[274px]">
        <header className="glass-toolbar layer-sticky sticky top-3 mx-3 mt-3 flex h-14 items-center justify-between rounded-2xl px-3 sm:px-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              className="h-9 w-9 p-0 lg:hidden"
              aria-label="메뉴 열기"
              title="메뉴"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={19} />
            </Button>
            <div className="min-w-0 text-sm">
              <Link
                to="/dashboard"
                aria-label="Team Rocket 대시보드 breadcrumb"
                className="inline-flex items-center gap-2 rounded-sm font-extrabold text-ink transition hover:text-brand focus-visible:text-brand"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-lg border border-white/20 bg-brand text-[10px] font-black text-white shadow-sm">R</span>
                <span>Team Rocket</span>
              </Link>
              {currentProject.data && <span className="ml-2 hidden max-w-48 truncate font-semibold text-muted sm:inline-block">/ {currentProject.data.name}</span>}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Popover
              label="알림"
              dismissKey={location.pathname}
              className="w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-2xl shadow-2xl"
              trigger={(triggerProps) => (
                <Button
                  {...triggerProps}
                  variant="ghost"
                  className="relative h-9 w-9 p-0"
                  aria-label={`알림${unread ? ` ${unread}개 읽지 않음` : ""}`}
                  title="알림"
                >
                  <Bell size={18} />
                  {unread > 0 && (
                    <span className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </Button>
              )}
            >
              {(close) => (
                <>
                  <div className="flex items-center justify-between border-b border-line px-4 py-3">
                    <div>
                      <h2 className="text-sm font-extrabold text-ink">알림</h2>
                      <p className="text-[10px] text-muted">읽지 않음 {unread}개</p>
                    </div>
                    <button className="text-xs font-semibold text-brand disabled:text-muted" disabled={!unread} onClick={() => void markAllRead()}>
                      모두 읽음
                    </button>
                  </div>
                  <div className="max-h-96 divide-y divide-line overflow-y-auto">
                    {notifications.data?.slice(0, 10).map((notification) => (
                      <button key={notification.id} className={cn("flex w-full gap-3 p-3 text-left hover:bg-raised", !notification.read_at && "bg-brand/[.04]")} onClick={() => void openNotification(notification, close)}>
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand" />
                        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold leading-5 text-ink">{notification.title}</span><span className="mt-1 block text-[10px] text-muted">{formatRelativeTime(notification.created_at)}</span></span>
                      </button>
                    ))}
                    {!notifications.data?.length && <p className="p-8 text-center text-sm text-muted">알림이 없습니다.<br />새로운 알림이 생기면 여기에 표시됩니다.</p>}
                  </div>
                  <button className="w-full border-t border-line px-4 py-3 text-xs font-semibold text-brand hover:bg-raised" onClick={() => { close(); navigate("/notifications"); }}>
                    모든 알림 보기
                  </button>
                </>
              )}
            </Popover>
            <ThemeCycleButton className="border-transparent" />
            <div className="ml-1 flex items-center gap-2 border-l border-line/70 pl-3">
              <Avatar
                name={profile?.name ?? "사용자"}
                url={profile?.avatar_url}
                size="sm"
              />
              <div className="hidden md:block">
                <div className="max-w-28 truncate text-xs font-bold text-ink">
                  {profile?.name}
                </div>
                <div className="text-[10px] text-muted">
                  {profile?.student_id}
                </div>
              </div>
              {admin ? (
                <Badge tone="purple" className="hidden xl:inline-flex">
                  시스템 관리자
                </Badge>
              ) : (
                profile?.github_username && (
                  <Badge tone="neutral" className="hidden xl:inline-flex">
                    @{profile.github_username}
                  </Badge>
                )
              )}
            </div>
          </div>
        </header>
        <main className="min-h-[calc(100vh-5rem)]">{children}</main>
      </div>
      <RocketAIPanel />
    </div>
  );
}
