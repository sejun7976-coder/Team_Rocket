import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckSquare, Github, KeyRound, Save, Settings as SettingsIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Avatar, Badge, Button, EmptyState, Input, PageHeader, Spinner } from "../components/ui";
import { listActivities, listNotifications, markNotificationRead } from "../services/activity";
import { listProjects } from "../services/projects";
import { listTasks } from "../services/tasks";
import { supabase } from "../lib/supabase";
import { useAuthStore } from "../stores/authStore";
import type { Project, Task } from "../types/domain";

async function accessibleTasks(): Promise<Array<Task & { project?: Project }>> {
  const projects = await listProjects();
  const groups = await Promise.all(projects.map(async (project) => (await listTasks(project.id)).map((task) => ({ ...task, project }))));
  return groups.flat();
}

export function MyTasksPage() {
  const user = useAuthStore((state) => state.user);
  const tasks = useQuery({ queryKey: ["accessible-tasks"], queryFn: accessibleTasks });
  const mine = tasks.data?.filter((task) => task.task_assignees?.some((assignee) => assignee.user_id === user?.id)) ?? [];
  return <div className="page-wrap"><PageHeader eyebrow="My work" title="내 작업" description="task_assignees.user_id가 현재 auth.uid()인 작업입니다." />{tasks.isLoading ? <Spinner /> : mine.length ? <div className="panel divide-y divide-line">{mine.map((task) => <Link key={task.id} to={`/tasks/${task.id}`} className="flex items-center gap-4 p-4 hover:bg-raised"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/10 text-brand"><CheckSquare size={17} /></div><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold text-ink">{task.title}</div><div className="mt-1 text-[11px] text-muted">{task.project?.name}</div></div><Badge tone={task.status === "done" ? "green" : task.status === "in_progress" ? "blue" : "neutral"}>{task.status}</Badge><span className="w-10 text-right text-xs font-bold text-muted">{task.progress}%</span></Link>)}</div> : <EmptyState icon={<CheckSquare />} title="담당 작업이 없습니다" description="프로젝트 Task 상세에서 복수 담당자로 지정되면 이곳에 표시됩니다." />}</div>;
}

export function GlobalCalendarPage() {
  const tasks = useQuery({ queryKey: ["accessible-tasks"], queryFn: accessibleTasks });
  const dated = (tasks.data ?? []).filter((task) => task.due_date || task.start_date).sort((a, b) => (a.due_date ?? a.start_date ?? "").localeCompare(b.due_date ?? b.start_date ?? ""));
  return <div className="page-wrap"><PageHeader eyebrow="All projects" title="전체 일정" description="RLS로 접근 가능한 프로젝트 일정만 집계합니다." />{tasks.isLoading ? <Spinner /> : <div className="panel divide-y divide-line">{dated.map((task) => <Link key={task.id} to={`/tasks/${task.id}`} className="flex items-center gap-4 p-4 hover:bg-raised"><div className="w-24 text-xs font-bold text-brand">{task.due_date ?? task.start_date}</div><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-ink">{task.title}</div><div className="text-[11px] text-muted">{task.project?.name}</div></div><Badge>{task.status}</Badge></Link>)}</div>}</div>;
}

export function GlobalActivityPage() {
  const activities = useQuery({ queryKey: ["activities", "all"], queryFn: () => listActivities() });
  return <div className="page-wrap"><PageHeader eyebrow="Audit" title="전체 활동" description="내가 접근 가능한 모든 프로젝트의 활동입니다." />{activities.isLoading ? <Spinner /> : <div className="panel divide-y divide-line">{activities.data?.map((item) => <div key={item.id} className="flex gap-3 p-4"><Avatar name={item.actor?.name ?? "시스템"} url={item.actor?.avatar_url} size="sm" /><div><p className="text-sm text-ink"><strong>{item.actor?.name ?? "시스템"}</strong> · {item.action}</p><p className="mt-1 text-[11px] text-muted">{new Date(item.created_at).toLocaleString("ko-KR")}</p></div></div>)}</div>}</div>;
}

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const notifications = useQuery({ queryKey: ["notifications"], queryFn: listNotifications });
  return <div className="page-wrap"><PageHeader eyebrow="Inbox" title="알림" />{notifications.isLoading ? <Spinner /> : <div className="panel divide-y divide-line">{notifications.data?.map((item) => <button key={item.id} onClick={async () => { if (!item.read_at) await markNotificationRead(item.id); if (item.project_id) location.hash = `#/projects/${item.project_id}`; await queryClient.invalidateQueries({ queryKey: ["notifications"] }); }} className={`flex w-full items-center gap-3 p-4 text-left hover:bg-raised ${!item.read_at ? "bg-brand/[.03]" : ""}`}><div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-brand/10 text-brand"><Bell size={16} />{!item.read_at && <span className="absolute right-0 top-0 h-2 w-2 rounded-full bg-red-500" />}</div><div className="flex-1"><div className="text-sm font-semibold text-ink">{item.title}</div><div className="mt-1 text-[11px] text-muted">{new Date(item.created_at).toLocaleString("ko-KR")}</div></div><Badge>{item.type}</Badge></button>)}</div>}</div>;
}

export function SettingsPage() {
  const { profile, refreshProfile } = useAuthStore();
  const [github, setGithub] = useState(profile?.github_username ?? "");
  const [name, setName] = useState(profile?.name ?? "");
  const [saved, setSaved] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); const { error } = await supabase.from("profiles").update({ name: name.trim(), github_username: github.trim() || null }).eq("id", profile!.id); if (error) throw new Error("프로필을 저장할 수 없습니다."); await refreshProfile(); setSaved(true); setTimeout(() => setSaved(false), 2500); };
  return <div className="page-wrap max-w-4xl"><PageHeader eyebrow="Account" title="설정" /><div className="grid gap-5 md:grid-cols-2"><form onSubmit={submit} className="panel p-5"><div className="flex items-center gap-2"><SettingsIcon size={18} className="text-brand" /><h2 className="font-extrabold text-ink">프로필</h2></div><label className="label mt-5" htmlFor="profile-name">이름</label><Input id="profile-name" value={name} onChange={(event) => setName(event.target.value)} /><label className="label mt-4" htmlFor="profile-student">학번</label><Input id="profile-student" value={profile?.student_id ?? ""} disabled /><label className="label mt-4" htmlFor="profile-github">GitHub Username</label><div className="relative"><Github className="absolute left-3 top-3 text-muted" size={16} /><Input id="profile-github" value={github} onChange={(event) => setGithub(event.target.value)} className="pl-9" placeholder="sejunpark" pattern="[A-Za-z0-9-]{1,39}" /></div><p className="mt-1.5 text-xs text-muted">GitHub 프로필 URL의 사용자명 (@username)을 입력하세요. 예: github.com/sejunpark → sejunpark</p><Button type="submit" className="mt-5"><Save size={15} /> {saved ? "저장됨" : "저장"}</Button></form><section className="panel p-5"><div className="flex items-center gap-2"><KeyRound size={18} className="text-brand" /><h2 className="font-extrabold text-ink">보안 및 암호화</h2></div><div className="mt-5 space-y-3 text-sm"><div className="subtle-panel flex items-center justify-between p-3"><span className="text-muted">테마</span><Badge>시스템 설정 따름</Badge></div><div className="subtle-panel flex items-center justify-between p-3"><span className="text-muted">자동 키 잠금</span><Badge tone="blue">15분</Badge></div><div className="subtle-panel flex items-center justify-between p-3"><span className="text-muted">사용자 keyring</span><Badge tone="green">활성</Badge></div><div className="subtle-panel flex items-center justify-between p-3"><span className="text-muted">Project data</span><Badge tone="blue">AES-256-GCM</Badge></div><div className="subtle-panel flex items-center justify-between p-3"><span className="text-muted">Key wrapping</span><Badge tone="purple">P-256 ECDH</Badge></div></div><p className="mt-4 text-xs leading-5 text-muted">private key와 Project key는 현재 탭의 메모리에만 존재하며 15분 미사용 시 잠깁니다.</p></section></div></div>;
}
