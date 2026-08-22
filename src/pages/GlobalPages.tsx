import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Bell,
  CalendarDays,
  CheckSquare,
  Github,
  Monitor,
  Save,
  Settings as SettingsIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Avatar,
  Alert,
  Badge,
  Button,
  EmptyState,
  Input,
  PageHeader,
  Spinner,
} from "../components/ui";
import {
  listActivities,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../services/activity";
import { listProjects } from "../services/projects";
import { listTasks } from "../services/tasks";
import { supabase } from "../lib/supabase";
import { useAuthStore } from "../stores/authStore";
import type { Project, Task } from "../types/domain";
import { ThemeCycleButton } from "../components/ThemeCycleButton";
import {
  activityLabel,
  formatRelativeTime,
  notificationTypeLabels,
  taskStatusLabels,
} from "../lib/display";

async function accessibleTasks(): Promise<Array<Task & { project?: Project }>> {
  const projects = await listProjects();
  const groups = await Promise.all(
    projects.map(async (project) =>
      (await listTasks(project.id)).map((task) => ({ ...task, project })),
    ),
  );
  return groups.flat();
}

export function MyTasksPage() {
  const user = useAuthStore((state) => state.user);
  const tasks = useQuery({
    queryKey: ["accessible-tasks"],
    queryFn: accessibleTasks,
  });
  const mine =
    tasks.data?.filter((task) =>
      task.task_assignees?.some((assignee) => assignee.user_id === user?.id),
    ) ?? [];
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="내 작업"
        title="내 작업"
        description="모든 프로젝트에서 내가 담당자로 지정된 작업을 모아봅니다."
      />
      {tasks.error ? (
        <Alert>작업을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. <Button size="sm" variant="ghost" onClick={() => void tasks.refetch()}>다시 시도</Button></Alert>
      ) : tasks.isLoading ? (
        <Spinner />
      ) : mine.length ? (
        <div className="panel divide-y divide-line">
          {mine.map((task) => (
            <Link
              key={task.id}
              to={`/tasks/${task.id}`}
              className="flex items-center gap-4 p-4 hover:bg-raised"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <CheckSquare size={17} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-ink">
                  {task.title}
                </div>
                <div className="mt-1 text-[11px] text-muted">
                  {task.project?.name}
                </div>
              </div>
              <Badge
                tone={
                  task.status === "done"
                    ? "green"
                    : task.status === "in_progress"
                      ? "blue"
                      : "neutral"
                }
              >
                {taskStatusLabels[task.status]}
              </Badge>
              <span className="w-10 text-right text-xs font-bold text-muted">
                {task.progress}%
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<CheckSquare />}
          title="담당 작업이 없습니다"
          description="프로젝트 작업의 담당자로 지정되면 여기에 표시됩니다."
        />
      )}
    </div>
  );
}

export function GlobalCalendarPage() {
  const tasks = useQuery({
    queryKey: ["accessible-tasks"],
    queryFn: accessibleTasks,
  });
  const dated = (tasks.data ?? [])
    .filter((task) => task.due_date || task.start_date)
    .sort((a, b) =>
      (a.due_date ?? a.start_date ?? "").localeCompare(
        b.due_date ?? b.start_date ?? "",
      ),
    );
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="전체 프로젝트"
        title="전체 일정"
        description="참여 중인 모든 프로젝트의 일정을 한곳에서 확인합니다."
      />
      {tasks.error ? (
        <Alert>일정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. <Button size="sm" variant="ghost" onClick={() => void tasks.refetch()}>다시 시도</Button></Alert>
      ) : tasks.isLoading ? (
        <Spinner />
      ) : dated.length ? (
        <div className="panel divide-y divide-line">
          {dated.map((task) => (
            <Link
              key={task.id}
              to={`/tasks/${task.id}`}
              className="flex items-center gap-4 p-4 hover:bg-raised"
            >
              <div className="w-24 text-xs font-bold text-brand">
                {task.due_date ?? task.start_date}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink">
                  {task.title}
                </div>
                <div className="text-[11px] text-muted">
                  {task.project?.name}
                </div>
              </div>
              <Badge>{taskStatusLabels[task.status]}</Badge>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState icon={<CalendarDays />} title="예정된 일정이 없습니다" description="작업에 시작일이나 마감일을 지정하면 여기에 표시됩니다." />
      )}
    </div>
  );
}

export function GlobalActivityPage() {
  const activities = useQuery({
    queryKey: ["activities", "all"],
    queryFn: () => listActivities(),
  });
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="활동"
        title="전체 활동"
        description="내가 접근 가능한 모든 프로젝트의 활동입니다."
      />
      {activities.error ? (
        <Alert>활동을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. <Button size="sm" variant="ghost" onClick={() => void activities.refetch()}>다시 시도</Button></Alert>
      ) : activities.isLoading ? (
        <Spinner />
      ) : activities.data?.length ? (
        <div className="panel divide-y divide-line">
          {activities.data?.map((item) => (
            <div key={item.id} className="flex gap-3 p-4">
              <Avatar
                name={item.actor?.name ?? "시스템"}
                url={item.actor?.avatar_url}
                size="sm"
              />
              <div>
                <p className="text-sm text-ink">
                  <strong>{item.actor?.name ?? "시스템"}</strong> ·{" "}
                  {activityLabel(item.action)}
                </p>
                <p className="mt-1 text-[11px] text-muted">
                  {formatRelativeTime(item.created_at)}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={<Activity />} title="활동 기록이 없습니다" description="프로젝트에서 변경한 내용이 생기면 여기에 표시됩니다." />
      )}
    </div>
  );
}

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: listNotifications,
  });
  return (
    <div className="page-wrap">
      <PageHeader eyebrow="알림" title="알림" action={<Button variant="secondary" disabled={!notifications.data?.some((item) => !item.read_at)} onClick={async () => { await markAllNotificationsRead(); await queryClient.invalidateQueries({ queryKey: ["notifications"] }); }}>모두 읽음</Button>} />
      {notifications.error ? (
        <Alert>알림을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. <Button size="sm" variant="ghost" onClick={() => void notifications.refetch()}>다시 시도</Button></Alert>
      ) : notifications.isLoading ? (
        <Spinner />
      ) : notifications.data?.length ? (
        <div className="panel divide-y divide-line">
          {notifications.data?.map((item) => (
            <button
              key={item.id}
              onClick={async () => {
                if (!item.read_at) await markNotificationRead(item.id);
                  navigate(item.task_id ? `/tasks/${item.task_id}` : item.type === "file_uploaded" && item.project_id ? `/projects/${item.project_id}/files` : item.project_id ? `/projects/${item.project_id}` : "/notifications");
                await queryClient.invalidateQueries({
                  queryKey: ["notifications"],
                });
              }}
              className={`flex w-full items-center gap-3 p-4 text-left hover:bg-raised ${!item.read_at ? "bg-brand/[.03]" : ""}`}
            >
              <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <Bell size={16} />
                {!item.read_at && (
                  <span className="absolute right-0 top-0 h-2 w-2 rounded-full bg-red-500" />
                )}
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-ink">
                  {item.title}
                </div>
                <div className="mt-1 text-[11px] text-muted">
                  {formatRelativeTime(item.created_at)}
                </div>
              </div>
              <Badge>{notificationTypeLabels[item.type]}</Badge>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState icon={<Bell />} title="알림이 없습니다" description="새로운 알림이 생기면 여기에 표시됩니다." />
      )}
    </div>
  );
}

export function SettingsPage() {
  const { profile, refreshProfile } = useAuthStore();
  const [github, setGithub] = useState(profile?.github_username ?? "");
  const [name, setName] = useState(profile?.name ?? "");
  const [saved, setSaved] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const { error } = await supabase
      .from("profiles")
      .update({ name: name.trim(), github_username: github.trim() || null })
      .eq("id", profile!.id);
    if (error) throw new Error("프로필을 저장할 수 없습니다.");
    await refreshProfile();
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };
  return (
    <div className="page-wrap max-w-4xl">
      <PageHeader eyebrow="계정" title="설정" />
      <div className="grid gap-5 md:grid-cols-2">
        <form onSubmit={submit} className="panel p-5">
          <div className="flex items-center gap-2">
            <SettingsIcon size={18} className="text-brand" />
            <h2 className="font-extrabold text-ink">프로필</h2>
          </div>
          <label className="label mt-5" htmlFor="profile-name">
            이름
          </label>
          <Input
            id="profile-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <label className="label mt-4" htmlFor="profile-student">
            학번
          </label>
          <Input
            id="profile-student"
            value={profile?.student_id ?? ""}
            disabled
          />
          <label className="label mt-4" htmlFor="profile-github">
            GitHub 사용자명
          </label>
          <div className="relative">
            <Github className="absolute left-3 top-3 text-muted" size={16} />
            <Input
              id="profile-github"
              value={github}
              onChange={(event) => setGithub(event.target.value)}
              className="pl-9"
              placeholder="github-username"
              pattern="[A-Za-z0-9-]{1,39}"
            />
          </div>
          <p className="mt-1.5 text-xs text-muted">
            GitHub 프로필 URL의 사용자명(@username)을 입력하세요. 예:
            github.com/username → username
          </p>
          <Button type="submit" className="mt-5">
            <Save size={15} /> {saved ? "저장됨" : "저장"}
          </Button>
        </form>
        <section className="panel p-5">
          <div className="flex items-center gap-2">
            <Monitor size={18} className="text-brand" />
            <h2 className="font-extrabold text-ink">화면</h2>
          </div>
          <div className="mt-5 flex items-center justify-between rounded-xl border border-line p-3">
            <span className="text-sm text-muted">테마</span>
            <ThemeCycleButton />
          </div>
        </section>
      </div>
    </div>
  );
}
