import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, CheckSquare, Clock3, FolderKanban, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { NewProjectDialog } from "../components/NewProjectDialog";
import { Avatar, Badge, Button, EmptyState, PageHeader, Spinner, StatCard } from "../components/ui";
import { isSystemAdmin } from "../lib/authPolicy";
import { usePermissions } from "../hooks/usePermissions";
import { ADMIN_PERMISSIONS } from "../../supabase/functions/_shared/adminPermissions";
import { listProjects } from "../services/projects";
import { useAuthStore } from "../stores/authStore";
import type { Project } from "../types/domain";

function progress(project: Project): number {
  const tasks = project.tasks ?? [];
  return tasks.length ? Math.round((tasks.filter((task) => task.status === "done").length / tasks.length) * 100) : 0;
}

function projectStatus(project: Project): { label: string; tone: "green" | "amber" } {
  return project.status === "creating"
    ? { label: "준비 중", tone: "amber" }
    : { label: "활성", tone: "green" };
}

export function DashboardPage() {
  const profile = useAuthStore((state) => state.profile);
  const user = useAuthStore((state) => state.user);
  const projects = useQuery({ queryKey: ["projects"], queryFn: listProjects });
  const [createOpen, setCreateOpen] = useState(false);
  const permissions = usePermissions();
  const canCreateProject = permissions.has(ADMIN_PERMISSIONS.PROJECTS_CREATE);
  const active = projects.data?.filter((project) => project.status !== "archived") ?? [];
  const allTasks = active.flatMap((project) => project.tasks ?? []);
  const myTasks = allTasks.filter((task) => task.task_assignees?.some((assignee) => assignee.user_id === user?.id));

  return (
    <div className="page-wrap">
      <PageHeader eyebrow="Team Rocket" title={`안녕하세요, ${profile?.name ?? "사용자"}님`} description="내가 만들었거나 팀원으로 참여 중인 프로젝트만 표시됩니다." action={canCreateProject ? <Button onClick={() => setCreateOpen(true)}><Plus size={17} /> 새 프로젝트</Button> : undefined} />
      {projects.isLoading ? <div className="flex min-h-72 items-center justify-center"><Spinner /></div> : projects.error ? <div className="panel p-5 text-sm text-red-600">{projects.error.message}</div> : <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="내 프로젝트" value={active.length} detail="참여 중인 프로젝트" icon={<FolderKanban size={18} />} />
          <StatCard label="내 작업" value={myTasks.length} detail="복수 담당 포함" icon={<CheckSquare size={18} />} />
          <StatCard label="진행 중" value={allTasks.filter((task) => task.status === "in_progress").length} detail="전체 접근 가능 프로젝트" icon={<Clock3 size={18} />} />
          <StatCard label="완료" value={allTasks.filter((task) => task.status === "done").length} detail={`${allTasks.length}개 작업 중`} icon={<CheckCircle2 size={18} />} />
        </div>
        <div className="mt-8 flex items-center justify-between"><h2 className="text-lg font-extrabold text-ink">내 프로젝트</h2><Link to="/projects" className="flex items-center gap-1 text-xs font-semibold text-brand">전체 보기 <ArrowRight size={14} /></Link></div>
        {active.length === 0 ? <div className="mt-3"><EmptyState icon={<FolderKanban />} title="아직 프로젝트가 없습니다" description={canCreateProject ? "첫 팀 프로젝트를 만들고 업무를 정리하세요." : "프로젝트에 초대되면 여기에 표시됩니다."} action={canCreateProject ? <Button onClick={() => setCreateOpen(true)}><Plus size={16} /> 새 프로젝트</Button> : undefined} /></div> : <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {active.map((project) => {
            const taskCount = project.tasks?.length ?? 0;
            const mine = project.tasks?.filter((task) => task.task_assignees?.some((assignee) => assignee.user_id === user?.id)).length ?? 0;
            const percent = progress(project);
            const status = projectStatus(project);
            return <Link key={project.id} to={`/projects/${project.id}`} className="panel group p-5 transition hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-lift">
              <div className="flex items-start justify-between gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 font-extrabold text-brand">{project.name.slice(0, 1).toUpperCase()}</div><Badge tone={status.tone}>{status.label}</Badge></div>
              <h3 className="mt-4 truncate text-base font-extrabold text-ink group-hover:text-brand">{project.name}</h3>
              <p className="mt-1 line-clamp-2 min-h-10 text-sm leading-5 text-muted">{project.description || "프로젝트 설명이 없습니다."}</p>
              <div className="mt-5"><div className="mb-2 flex items-center justify-between text-xs"><span className="font-semibold text-muted">진행률</span><span className="font-bold text-ink">{percent}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-brand transition-all" style={{ width: `${percent}%` }} /></div></div>
              <div className="mt-4 flex items-center justify-between border-t border-line pt-4 text-xs text-muted"><div className="flex gap-3"><span>내 작업 <strong className="text-ink">{mine}</strong></span><span>전체 <strong className="text-ink">{taskCount}</strong></span></div><div className="flex -space-x-1.5">{(project.project_members ?? []).slice(0, 3).map((member) => <Avatar key={member.user_id} name={member.user_id === user?.id ? profile?.name ?? "나" : "팀원"} size="sm" className="h-6 w-6" />)}</div></div>
            </Link>;
          })}
        </div>}
      </>}
      {canCreateProject && <NewProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} />}
    </div>
  );
}

export function ProjectsPage() {
  const projects = useQuery({ queryKey: ["projects"], queryFn: listProjects });
  const user = useAuthStore((state) => state.user);
  const profile = useAuthStore((state) => state.profile);
  const admin = isSystemAdmin(user, profile);
  const permissions = usePermissions();
  const canCreateProject = permissions.has(ADMIN_PERMISSIONS.PROJECTS_CREATE);
  const [createOpen, setCreateOpen] = useState(false);
  return (
    <div className="page-wrap">
      <PageHeader eyebrow="프로젝트" title="내 프로젝트" description={admin ? "내가 만들었거나 팀원으로 참여한 프로젝트입니다." : "관리자가 프로젝트에 초대하면 여기에 표시됩니다."} action={canCreateProject ? <Button onClick={() => setCreateOpen(true)}><Plus size={17} /> 새 프로젝트</Button> : undefined} />
      {projects.isLoading ? <Spinner /> : projects.data?.length ? <div className="space-y-3">{projects.data.map((project) => { const status = projectStatus(project); return <Link key={project.id} to={`/projects/${project.id}`} className="panel flex flex-col gap-4 p-4 transition hover:border-brand/30 sm:flex-row sm:items-center"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 font-extrabold text-brand">{project.name[0]}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="truncate font-bold text-ink">{project.name}</h3><Badge tone={status.tone}>{status.label}</Badge></div><p className="mt-1 truncate text-xs text-muted">{project.description || "프로젝트 설명이 없습니다."}</p></div><div className="flex items-center gap-6 text-xs text-muted"><span>작업 <strong className="text-ink">{project.tasks?.length ?? 0}</strong></span><span>팀원 <strong className="text-ink">{project.project_members?.length ?? 0}</strong></span><ArrowRight size={16} /></div></Link>; })}</div> : <EmptyState icon={<FolderKanban />} title="참여 중인 프로젝트가 없습니다" description={canCreateProject ? "새 프로젝트를 만들어 팀원을 초대하세요." : "프로젝트에 초대되면 여기에 표시됩니다."} action={canCreateProject ? <Button onClick={() => setCreateOpen(true)}><Plus size={16} /> 새 프로젝트</Button> : undefined} />}
      {canCreateProject && <NewProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} />}
    </div>
  );
}
