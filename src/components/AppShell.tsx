import { useQuery } from "@tanstack/react-query";
import { Activity, Bell, CalendarDays, CheckSquare, FolderCog, FolderKanban, LayoutDashboard, LogOut, Menu, Monitor, Moon, Settings, Shield, SlidersHorizontal, Sun, Users, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { isSystemAdmin } from "../lib/authPolicy";
import { cn } from "../lib/utils";
import { KEYRING_INACTIVITY_TIMEOUT_MS, readLastActivityAt, touchSessionKeyring, writeLastActivityAt } from "../crypto";
import { listNotifications } from "../services/activity";
import { useAuthStore } from "../stores/authStore";
import { useProjectKeyStore } from "../stores/projectKeyStore";
import { useThemeStore, type ThemePreference } from "../stores/themeStore";
import { Avatar, Badge, Button } from "./ui";

const nav = [
  ["/dashboard", "Dashboard", LayoutDashboard],
  ["/projects", "내 프로젝트", FolderKanban],
  ["/my-tasks", "내 작업", CheckSquare],
  ["/calendar", "일정", CalendarDays],
  ["/activity", "활동", Activity]
] as const;

const adminNav = [
  ["/admin/users", "사용자 관리", Users],
  ["/admin/projects", "프로젝트 관리", FolderCog],
  ["/admin/system", "시스템 설정", SlidersHorizontal]
] as const;

function NavigationLink({ to, label, Icon }: { to: string; label: string; Icon: typeof LayoutDashboard }) {
  return <NavLink to={to} className={({ isActive }) => cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition", isActive ? "bg-brand/10 text-brand" : "text-muted hover:bg-raised hover:text-ink")}><Icon size={18} />{label}</NavLink>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, profile, logout, lockKeyring } = useAuthStore();
  const admin = isSystemAdmin(user, profile);
  const forgetAll = useProjectKeyStore((state) => state.forgetAll);
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const theme = useThemeStore((state) => state.preference);
  const setTheme = useThemeStore((state) => state.setPreference);
  const notifications = useQuery({ queryKey: ["notifications"], queryFn: listNotifications, refetchInterval: 60_000 });
  const unread = notifications.data?.filter((item) => !item.read_at).length ?? 0;

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
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
      if (locking || Date.now() - lastActivity < KEYRING_INACTIVITY_TIMEOUT_MS) return;
      locking = true;
      forgetAll();
      await lockKeyring();
      navigate("/unlock", { replace: true });
    };
    const interval = window.setInterval(() => {
      void lockIfExpired();
    }, 5_000);
    void lockIfExpired();
    ["pointerdown", "keydown", "touchstart", "scroll"].forEach((event) => window.addEventListener(event, mark, { passive: true }));
    return () => { window.clearInterval(interval); ["pointerdown", "keydown", "touchstart", "scroll"].forEach((event) => window.removeEventListener(event, mark)); };
  }, [forgetAll, lockKeyring, navigate, user]);

  const signOut = async () => { forgetAll(); await logout(); navigate("/login", { replace: true }); };
  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const themeLabel = theme === "light" ? "라이트" : theme === "dark" ? "다크" : "시스템";
  const sidebar = <aside className="flex h-full w-[250px] flex-col border-r border-line bg-surface"><div className="flex h-16 items-center gap-3 border-b border-line px-5"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand font-black text-white">R</div><div><div className="text-sm font-extrabold tracking-tight text-ink">Rocket Campus</div><div className="text-[9px] font-bold uppercase tracking-[.16em] text-muted">Project workspace</div></div></div><nav className="scrollbar-thin flex-1 space-y-1 overflow-y-auto p-3">{nav.map(([to, label, Icon]) => <NavigationLink key={to} to={to} label={label} Icon={Icon} />)}{admin && <div className="mt-5 border-t border-line pt-4"><div className="mb-2 flex items-center gap-2 px-3 text-[10px] font-black uppercase tracking-[.14em] text-muted"><Shield size={13} /> 관리자</div>{adminNav.map(([to, label, Icon]) => <NavigationLink key={to} to={to} label={label} Icon={Icon} />)}</div>}</nav><div className="border-t border-line p-3"><NavigationLink to="/settings" label="설정" Icon={Settings} /><button onClick={() => void signOut()} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted hover:bg-red-500/10 hover:text-red-600"><LogOut size={18} />로그아웃</button></div></aside>;

  return <div className="min-h-screen bg-canvas"><div className="fixed inset-y-0 left-0 z-40 hidden lg:block">{sidebar}</div>{mobileOpen && <div className="fixed inset-0 z-50 lg:hidden"><button aria-label="메뉴 닫기" className="absolute inset-0 bg-slate-950/45" onClick={() => setMobileOpen(false)} /><div className="relative h-full w-[270px]">{sidebar}<Button variant="ghost" className="absolute right-3 top-4 h-8 w-8 p-0" onClick={() => setMobileOpen(false)}><X size={18} /></Button></div></div>}<div className="lg:pl-[250px]"><header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-surface/90 px-4 backdrop-blur sm:px-6"><div className="flex items-center gap-3"><Button variant="ghost" className="h-9 w-9 p-0 lg:hidden" onClick={() => setMobileOpen(true)}><Menu size={19} /></Button><div className="hidden text-sm font-semibold text-muted sm:block">안녕하세요, <span className="text-ink">{profile?.name}</span>님</div></div><div className="flex items-center gap-1.5"><Button variant="ghost" className="relative h-9 w-9 p-0" aria-label="알림" onClick={() => navigate("/notifications")}><Bell size={18} />{unread > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" />}</Button><label className="relative inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl px-2.5 text-sm font-semibold text-muted transition hover:bg-raised hover:text-ink" title={`테마: ${themeLabel}`}><ThemeIcon size={17} /><span className="hidden xl:inline">{themeLabel}</span><select aria-label="테마" value={theme} onChange={(event) => setTheme(event.target.value as ThemePreference)} className="absolute inset-0 cursor-pointer opacity-0"><option value="system">시스템</option><option value="light">라이트</option><option value="dark">다크</option></select></label><div className="ml-2 flex items-center gap-2 border-l border-line pl-3"><Avatar name={profile?.name ?? "사용자"} url={profile?.avatar_url} size="sm" /><div className="hidden md:block"><div className="max-w-28 truncate text-xs font-bold text-ink">{profile?.name}</div><div className="text-[10px] text-muted">{profile?.student_id}</div></div>{admin ? <Badge tone="purple" className="hidden xl:inline-flex">system admin</Badge> : profile?.github_username && <Badge tone="neutral" className="hidden xl:inline-flex">@{profile.github_username}</Badge>}</div></div></header><main>{children}</main></div></div>;
}
