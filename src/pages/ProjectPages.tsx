import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  CalendarDays,
  Clock3,
  CheckSquare,
  CircleDot,
  FileText,
  LayoutDashboard,
  ListTodo,
  MessageSquare,
  Megaphone,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Save,
  Search,
  Settings,
  ShieldAlert,
  Trash2,
  AlertTriangle,
  Upload,
  Users,
  X,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from "react-router-dom";
import { useProjectRealtime } from "../hooks/useProjectRealtime";
import { cn } from "../lib/utils";
import {
  getProject,
  getProjectAnnouncement,
  listProjectMembers,
  saveProjectAnnouncement,
} from "../services/projects";
import { listProjectActivities } from "../services/activity";
import { createTask, deleteTask, listTasks, updateTask } from "../services/tasks";
import { uploadProjectFile } from "../services/files";
import { MAX_FILE_SIZE_LABEL, validateProjectFile } from "../lib/filePolicy";
import {
  activityLabel,
  activityTargetLabel,
  projectRoleLabels,
  taskPriorityLabels,
  taskStatusLabels,
} from "../lib/display";
import { formatBytes } from "../lib/utils";
import { useAuthStore } from "../stores/authStore";
import type {
  Project,
  ProjectMember,
  Task,
  TaskPriority,
  TaskStatus,
} from "../types/domain";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Popover,
  Spinner,
  useToast,
} from "../components/ui";

const projectNav = [
  ["", "개요", LayoutDashboard],
  ["board", "보드", LayoutDashboard],
  ["tasks", "작업", ListTodo],
  ["calendar", "캘린더", CalendarDays],
  ["files", "파일", FileText],
  ["activity", "활동", Activity],
  ["team", "팀", Users],
  ["settings", "설정", Settings],
] as const;

interface ProjectContext {
  project: Project;
}
export function useProjectContext(): ProjectContext {
  return useOutletContext<ProjectContext>();
}

export function ProjectLayoutPage() {
  const { projectId } = useParams();
  const location = useLocation();
  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId),
  });
  const members = useQuery({
    queryKey: ["members", projectId],
    queryFn: () => listProjectMembers(projectId!),
    enabled: Boolean(projectId),
  });
  useProjectRealtime(projectId);
  if (project.isLoading)
    return (
      <div className="page-wrap flex min-h-72 items-center justify-center">
        <Spinner />
      </div>
    );
  if (project.error || !project.data)
    return (
      <div className="page-wrap">
        <EmptyState
          icon={<ShieldAlert />}
          title="프로젝트에 접근할 수 없습니다"
          description="프로젝트가 없거나 접근 권한이 없습니다."
        />
      </div>
    );
  return (
    <div>
      <div className="project-workspace-header px-4 pt-3 sm:px-6 lg:px-8">
        <div className="project-workspace-shell mx-auto max-w-[1436px] p-3 sm:p-4">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-lg font-extrabold text-brand">
                {project.data.name.charAt(0).toUpperCase() || "P"}
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h1 className="max-w-full truncate text-xl font-extrabold text-ink">
                    {project.data.name}
                  </h1>
                  <Badge
                    tone={
                      project.data.status === "active"
                        ? "green"
                        : project.data.status === "error"
                          ? "amber"
                          : "amber"
                    }
                  >
                    {project.data.status === "active"
                      ? "프로젝트 활성"
                      : project.data.status === "error"
                        ? "프로젝트 활성 · 설정 확인"
                        : project.data.status}
                  </Badge>
                </div>
                <p className="mt-0.5 max-w-2xl truncate text-xs text-muted">{project.data.description || "Team Rocket 프로젝트 워크스페이스"}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
              <span className="text-[11px] font-bold text-muted sm:hidden lg:inline">참여 팀원</span>
              <Popover
                label="프로젝트 참여 팀원"
                dismissKey={location.pathname}
                className="w-[min(320px,calc(100vw-2rem))] overflow-hidden"
                trigger={(triggerProps) => (
                  <button
                    {...triggerProps}
                    type="button"
                    aria-label={`프로젝트 참여 팀원 ${members.data?.length ?? 0}명 보기`}
                    title="전체 참여 팀원 보기"
                    className="project-member-cluster flex cursor-pointer items-center rounded-xl px-2 py-1.5 transition hover:bg-raised/70"
                  >
                    <span className="flex -space-x-2">
                      {members.data?.slice(0, 5).map((member) => (
                        <span key={member.user_id} title={member.profile?.name ?? "팀원"} className="rounded-full ring-2 ring-surface">
                          <Avatar
                            name={member.profile?.name ?? "팀원"}
                            url={member.profile?.avatar_url}
                            size="sm"
                          />
                        </span>
                      ))}
                    </span>
                    {(members.data?.length ?? 0) > 5 && (
                      <span className="ml-1.5 text-xs font-bold text-muted">+{members.data!.length - 5}</span>
                    )}
                    {members.isLoading && <Spinner className="ml-1 h-5 w-5" />}
                    {!members.isLoading && !members.data?.length && <Users className="text-muted" size={19} />}
                  </button>
                )}
              >
                <div className="border-b border-line px-4 py-3">
                  <h2 className="text-sm font-extrabold text-ink">참여 팀원</h2>
                  <p className="mt-0.5 text-[10px] text-muted">총 {members.data?.length ?? 0}명</p>
                </div>
                <div className="max-h-80 divide-y divide-line overflow-y-auto p-1">
                  {members.data?.map((member) => (
                    <div key={member.user_id} className="flex items-center gap-3 rounded-lg px-3 py-2.5">
                      <Avatar name={member.profile?.name ?? "팀원"} url={member.profile?.avatar_url} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink">{member.profile?.name ?? "팀원"}</p>
                        <p className="truncate text-[10px] text-muted">{member.profile?.student_id ?? "식별 정보 없음"}</p>
                      </div>
                      <Badge tone={member.role === "owner" ? "purple" : "neutral"}>
                        {projectRoleLabels[member.role]}
                      </Badge>
                    </div>
                  ))}
                  {members.error && <p className="p-4 text-center text-xs text-red-600">팀원 목록을 불러오지 못했습니다.</p>}
                </div>
              </Popover>
            </div>
          </div>
          <nav className="scrollbar-thin project-tabs mt-3 max-w-full overflow-x-auto">
            {projectNav.map(([path, label, Icon]) => (
                <NavLink
                  end={path === ""}
                  key={path}
                  to={`/projects/${projectId}${path ? `/${path}` : ""}`}
                  className={({ isActive }) =>
                    cn(
                      "flex shrink-0 items-center gap-2 rounded-xl border border-transparent px-3 py-2 text-xs font-semibold transition",
                      isActive
                        ? "project-tab-active"
                        : "text-muted hover:bg-raised/70 hover:text-ink",
                    )
                  }
                >
                  <Icon size={15} />
                  {label}
                </NavLink>
              ))}
          </nav>
        </div>
      </div>
      <Outlet context={{ project: project.data }} />
    </div>
  );
}

function statusLabel(status: TaskStatus): string {
  return taskStatusLabels[status];
}

function statusTone(
  status: TaskStatus,
): "neutral" | "blue" | "purple" | "green" {
  return {
    todo: "neutral",
    in_progress: "blue",
    review: "purple",
    done: "green",
  }[status] as "neutral" | "blue" | "purple" | "green";
}

function projectProgress(tasks: Task[]): number {
  return tasks.length
    ? Math.round(
        tasks.reduce((sum, task) => sum + task.progress, 0) / tasks.length,
      )
    : 0;
}

function ProjectAnnouncementCard({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const announcement = useQuery({
    queryKey: ["project-announcement", projectId],
    queryFn: () => getProjectAnnouncement(projectId),
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const saveAnnouncement = useMutation({
    mutationFn: () => saveProjectAnnouncement(projectId, draft),
    onSuccess: async (saved) => {
      queryClient.setQueryData(["project-announcement", projectId], saved);
      setEditing(false);
      showToast("공지사항이 저장되었습니다.", { tone: "success" });
      await queryClient.invalidateQueries({ queryKey: ["activities", projectId] });
    },
    onError: () => showToast("공지사항을 저장하지 못했습니다.", { tone: "error" }),
  });
  const beginEditing = () => {
    setDraft(announcement.data?.content ?? "");
    saveAnnouncement.reset();
    setEditing(true);
  };
  const cancelEditing = () => {
    setDraft(announcement.data?.content ?? "");
    saveAnnouncement.reset();
    setEditing(false);
  };
  return (
      <section className="overview-announcement-section">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <Megaphone size={17} />
            </span>
            <div>
              <h2 className="text-sm font-extrabold text-ink">공지사항</h2>
              <p className="text-[10px] text-muted">프로젝트 멤버 모두가 함께 편집할 수 있습니다.</p>
            </div>
          </div>
          {!editing && (
            <Button size="sm" variant="secondary" onClick={beginEditing} disabled={announcement.isLoading}>
              <Pencil size={14} /> {announcement.data?.content ? "공지 편집" : "공지 작성"}
            </Button>
          )}
        </div>
        <div className="pt-3">
          {announcement.isLoading ? (
            <div className="flex min-h-16 items-center justify-center"><Spinner /></div>
          ) : announcement.error ? (
            <Alert>
              공지사항을 불러오지 못했습니다. <Button size="sm" variant="ghost" onClick={() => void announcement.refetch()}>다시 시도</Button>
            </Alert>
          ) : editing ? (
            <form onSubmit={(event) => { event.preventDefault(); saveAnnouncement.mutate(); }}>
              <label className="label" htmlFor="project-announcement">공지 내용</label>
              <textarea
                id="project-announcement"
                className="field min-h-28 resize-y"
                value={draft}
                maxLength={5000}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="팀원에게 공유할 중요 일정이나 안내를 작성하세요."
                autoFocus
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-[10px] text-muted">{draft.length.toLocaleString("ko-KR")} / 5,000자</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={cancelEditing} disabled={saveAnnouncement.isPending}>취소</Button>
                  <Button size="sm" type="submit" disabled={saveAnnouncement.isPending}>
                    {saveAnnouncement.isPending ? <Spinner className="h-4 w-4" /> : <Save size={14} />} 저장
                  </Button>
                </div>
              </div>
            </form>
          ) : announcement.data?.content ? (
            <div>
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-ink">{announcement.data.content}</p>
              <p className="mt-4 text-[10px] text-muted">
                {announcement.data.updater?.name ?? "알 수 없는 사용자"}님이 {new Date(announcement.data.updated_at).toLocaleString("ko-KR")} 수정
              </p>
            </div>
          ) : (
            <div className="overview-inline-empty py-3 text-center">
              <p className="text-sm font-semibold text-ink">등록된 공지가 없습니다.</p>
              <p className="mt-1 text-xs text-muted">중요한 일정이나 팀 안내를 공유해 보세요.</p>
            </div>
          )}
        </div>
      </section>
  );
}

export function ProjectOverviewPage() {
  const { project } = useProjectContext();
  const tasks = useQuery({
    queryKey: ["tasks", project.id],
    queryFn: () => listTasks(project.id),
  });
  const activities = useQuery({
    queryKey: ["activities", project.id],
    queryFn: () => listProjectActivities(project.id),
  });
  const user = useAuthStore((state) => state.user);
  const list = tasks.data ?? [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const inDays = (task: Task) => task.due_date ? Math.round((new Date(`${task.due_date}T00:00:00`).getTime() - now.getTime()) / 86_400_000) : null;
  const overdue = list.filter((task) => task.status !== "done" && inDays(task) !== null && inDays(task)! < 0);
  const dueSoon = list.filter((task) => task.status !== "done" && inDays(task) !== null && inDays(task)! <= 3).sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")).slice(0, 8);
  const myTasks = list.filter((task) => task.task_assignees?.some((item) => item.user_id === user?.id));
  const importantMine = [...myTasks].filter((task) => task.status !== "done").sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999")).slice(0, 5);
  const progress = projectProgress(list);
  const stats = [
    { label: "전체 작업", value: list.length, icon: <CheckSquare size={15} />, tone: "brand" },
    { label: "완료", value: list.filter((task) => task.status === "done").length, icon: <CheckSquare size={15} />, tone: "success" },
    { label: "진행 중", value: list.filter((task) => task.status === "in_progress" || task.status === "review").length, icon: <CircleDot size={15} />, tone: "brand" },
    { label: "할 일", value: list.filter((task) => task.status === "todo").length, icon: <Clock3 size={15} />, tone: "neutral" },
    { label: "지연", value: overdue.length, icon: <AlertTriangle size={15} />, tone: "danger" },
  ] as const;
  return (
    <div className="page-wrap project-overview-page">
      <div className="project-overview-intro">
        <PageHeader
          eyebrow="프로젝트 개요"
          title="프로젝트 현황"
          description={project.description ?? "프로젝트 설명이 없습니다."}
        />
      </div>

      <section className="project-overview-surface">
        <ProjectAnnouncementCard projectId={project.id} />
        <div className="overview-divider" />

        <section className="overview-progress-section">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-extrabold text-ink">프로젝트 진행률</h2>
              <p className="mt-0.5 text-[11px] text-muted">전체 작업의 진행 상태를 반영합니다.</p>
            </div>
            <strong className="text-xl font-extrabold tracking-tight text-brand">{progress}%</strong>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-line/70">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${progress}%` }} />
          </div>
        </section>

        <div className="overview-divider" />
        {tasks.error || activities.error ? (
          <Alert>프로젝트 현황을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</Alert>
        ) : tasks.isLoading ? (
          <div className="flex min-h-20 items-center justify-center"><Spinner /></div>
        ) : (
          <div className="overview-stat-strip">
            {stats.map((stat) => (
              <div key={stat.label} className="overview-stat-item">
                <span className={cn("overview-stat-icon", `overview-stat-icon--${stat.tone}`)}>{stat.icon}</span>
                <span className="text-[11px] font-semibold text-muted">{stat.label}</span>
                <strong className={cn("text-xl font-extrabold tracking-tight text-ink", stat.tone === "danger" && stat.value > 0 && "text-red-600")}>{stat.value}</strong>
              </div>
            ))}
          </div>
        )}
      </section>

      {!tasks.error && !activities.error && !tasks.isLoading && (
        <section className="project-overview-secondary">
          <div className="grid lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,.75fr)]">
            <section className="overview-content-section border-b border-line/60 lg:border-b-0 lg:border-r">
              <div className="overview-section-heading">
                <h2>최근 작업</h2>
                <Link to={`/projects/${project.id}/board`}>보드 보기</Link>
              </div>
              <div className="mt-3 space-y-1.5">
                {list.slice(0, 6).map((task) => (
                  <Link key={task.id} to={`/tasks/${task.id}`} className="overview-task-row">
                    <Badge tone={statusTone(task.status)}>{statusLabel(task.status)}</Badge>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{task.title}</span>
                    <span className="text-xs font-bold text-muted">{task.progress}%</span>
                  </Link>
                ))}
                {list.length === 0 && <p className="overview-inline-empty">아직 작업이 없습니다.</p>}
              </div>
            </section>

            <section className="overview-content-section">
              <div className="overview-section-heading">
                <h2>최근 활동</h2>
                <Link to={`/projects/${project.id}/activity`}>전체 보기</Link>
              </div>
              <div className="mt-3 space-y-3">
                {activities.data?.slice(0, 6).map((activity) => (
                  <div key={activity.id} className="flex gap-3">
                    <Avatar name={activity.actor?.name ?? "시스템"} url={activity.actor?.avatar_url} size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm leading-5 text-ink"><strong>{activity.actor?.name ?? "시스템"}</strong>님이 {activityLabel(activity.action)}</p>
                      <p className="mt-0.5 text-[10px] text-muted">{activityTargetLabel(activity.subject_type)} · {new Date(activity.created_at).toLocaleString("ko-KR")}</p>
                    </div>
                  </div>
                ))}
                {!activities.data?.length && <p className="overview-inline-empty">최근 활동이 없습니다.</p>}
              </div>
            </section>
          </div>

          <div className="overview-divider m-0" />
          <div className="grid lg:grid-cols-2">
            <section className="overview-content-section border-b border-line/60 lg:border-b-0 lg:border-r">
              <div className="overview-section-heading">
                <h2>내 작업</h2>
                <Link to="/my-tasks">전체 보기</Link>
              </div>
              <div className="overview-mini-stat-strip">
                <div><strong>{myTasks.filter((task) => inDays(task) === 0 && task.status !== "done").length}</strong><span>오늘</span></div>
                <div><strong>{myTasks.filter((task) => inDays(task) !== null && inDays(task)! >= 0 && inDays(task)! <= 7 && task.status !== "done").length}</strong><span>이번 주</span></div>
                <div><strong className="text-red-600">{myTasks.filter((task) => task.status !== "done" && inDays(task) !== null && inDays(task)! < 0).length}</strong><span>지연</span></div>
              </div>
              <div className="mt-3 space-y-1.5">
                {importantMine.map((task) => (
                  <Link key={task.id} to={`/tasks/${task.id}`} className="overview-task-row">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{task.title}</span>
                    <Badge tone={inDays(task) !== null && inDays(task)! < 0 ? "red" : inDays(task) === 0 ? "amber" : "neutral"}>{inDays(task) === null ? "마감 없음" : inDays(task)! < 0 ? `${Math.abs(inDays(task)!)}일 지연` : inDays(task) === 0 ? "오늘 마감" : `${inDays(task)}일 남음`}</Badge>
                  </Link>
                ))}
                {!importantMine.length && <p className="overview-inline-empty">진행 중인 내 작업이 없습니다.</p>}
              </div>
            </section>

            <section className="overview-content-section">
              <div className="overview-section-heading">
                <h2>마감 임박</h2>
                <Link to={`/projects/${project.id}/calendar`}>캘린더 보기</Link>
              </div>
              <div className="mt-3 space-y-1.5">
                {dueSoon.map((task) => (
                  <Link key={task.id} to={`/tasks/${task.id}`} className="overview-task-row">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{task.title}</span>
                    <span className={`text-xs font-bold ${inDays(task)! < 0 ? "text-red-600" : "text-muted"}`}>{inDays(task)! < 0 ? `${Math.abs(inDays(task)!)}일 지연` : inDays(task) === 0 ? "오늘" : inDays(task) === 1 ? "내일" : `${inDays(task)}일 이내`}</span>
                  </Link>
                ))}
                {!dueSoon.length && <p className="overview-inline-empty">3일 이내 마감 작업이 없습니다.</p>}
              </div>
            </section>
          </div>
        </section>
      )}
    </div>
  );
}

export function TaskFormDialog({
  open,
  onClose,
  projectId,
  members,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  members: ProjectMember[];
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [fileError, setFileError] = useState("");
  const [uploadProgress, setUploadProgress] = useState<{
    name: string;
    percent: number;
  } | null>(null);
  const reset = () => {
    setTitle("");
    setDescription("");
    setPriority("medium");
    setDueDate("");
    setAssigneeIds([]);
    setAttachments([]);
    setFileError("");
    setUploadProgress(null);
  };
  const close = () => {
    if (!mutation.isPending) {
      reset();
      mutation.reset();
      onClose();
    }
  };
  const addFiles = (selected: File[]) => {
    try {
      selected.forEach(validateProjectFile);
      setAttachments((current) =>
        [...current, ...selected].filter(
          (file, index, all) =>
            all.findIndex(
              (candidate) =>
                candidate.name === file.name &&
                candidate.size === file.size &&
                candidate.lastModified === file.lastModified,
            ) === index,
        ),
      );
      setFileError("");
    } catch (error) {
      setFileError(
        error instanceof Error ? error.message : "파일을 추가할 수 없습니다.",
      );
    }
  };
  const mutation = useMutation({
    mutationFn: async () => {
      const task = await createTask({
        projectId,
        title,
        description,
        priority,
        dueDate: dueDate || undefined,
        assigneeIds,
      });
      let failed = 0;
      for (const file of attachments) {
        try {
          await uploadProjectFile(projectId, file, task.id, (_phase, percent) =>
            setUploadProgress({ name: file.name, percent }),
          );
        } catch {
          failed += 1;
        }
      }
      return { task, failed, total: attachments.length };
    },
    onSuccess: async ({ task, failed, total }) => {
      queryClient.setQueryData<Task[]>(["tasks", projectId], (current = []) =>
        current.some((item) => item.id === task.id) ? current : [task, ...current],
      );
      reset();
      mutation.reset();
      onClose();
      showToast("작업이 생성되었습니다.", { tone: "success", dedupeKey: `task-created:${task.id}` });
      if (failed) {
        showToast(`작업은 생성됐지만 ${total}개 파일 중 ${failed}개를 업로드하지 못했습니다.`, {
          tone: "warning",
          dedupeKey: `task-attachment-failed:${task.id}`,
        });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tasks", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["files", projectId] }),
      ]);
    },
    onError: () => showToast("작업을 생성하지 못했습니다.", { tone: "error" }),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title="새 작업"
      description="설명과 첨부 파일은 브라우저에서 암호화됩니다."
      className="max-w-2xl"
    >
      <form
        onSubmit={submit}
        className="max-h-[75vh] space-y-4 overflow-y-auto pr-1"
      >
        <div>
          <label className="label" htmlFor="task-title">
            제목
          </label>
          <Input
            id="task-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={240}
            required
            autoFocus
            disabled={mutation.isPending}
          />
        </div>
        <div>
          <label className="label" htmlFor="task-description">
            설명
          </label>
          <textarea
            id="task-description"
            className="field min-h-24"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={mutation.isPending}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="task-priority">
              우선순위
            </label>
            <select
              id="task-priority"
              className="field"
              value={priority}
              onChange={(event) =>
                setPriority(event.target.value as TaskPriority)
              }
              disabled={mutation.isPending}
            >
              <option value="low">낮음</option>
              <option value="medium">보통</option>
              <option value="high">높음</option>
              <option value="urgent">긴급</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="task-due">
              마감일
            </label>
            <Input
              id="task-due"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              disabled={mutation.isPending}
            />
          </div>
        </div>
        <fieldset disabled={mutation.isPending}>
          <legend className="label">담당자 (복수 선택)</legend>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
            {members.map((member) => (
              <label
                key={member.user_id}
                className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-raised"
              >
                <input
                  type="checkbox"
                  checked={assigneeIds.includes(member.user_id)}
                  onChange={(event) =>
                    setAssigneeIds((current) =>
                      event.target.checked
                        ? [...current, member.user_id]
                        : current.filter((id) => id !== member.user_id),
                    )
                  }
                />
                <Avatar
                  name={member.profile?.name ?? "팀원"}
                  url={member.profile?.avatar_url}
                  size="sm"
                />
                <span className="text-sm font-medium text-ink">
                  {member.profile?.name}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset disabled={mutation.isPending}>
          <legend className="label">첨부 파일 (선택)</legend>
          <label
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              addFiles(Array.from(event.dataTransfer.files));
            }}
            className="flex cursor-pointer flex-col items-center rounded-xl border border-dashed border-line p-4 text-center transition hover:border-brand/50 hover:bg-brand/[.03]"
          >
            <Upload size={20} className="text-brand" />
            <span className="mt-2 text-sm font-semibold text-ink">
              파일 추가 또는 여기로 끌어놓기
            </span>
            <span className="mt-1 text-xs text-muted">
              파일당 최대 {MAX_FILE_SIZE_LABEL} · 실행 파일 제외
            </span>
            <input
              type="file"
              multiple
              className="sr-only"
              onChange={(event) => {
                addFiles(Array.from(event.target.files ?? []));
                event.currentTarget.value = "";
              }}
            />
          </label>
          {fileError && (
            <p className="mt-2 text-xs text-red-600">{fileError}</p>
          )}
          <div className="mt-2 space-y-2">
            {attachments.map((file, index) => (
              <div
                key={`${file.name}-${file.lastModified}`}
                className="flex items-center gap-2 rounded-lg bg-raised p-2"
              >
                <Paperclip size={14} className="text-brand" />
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">
                  {file.name}
                </span>
                <span className="text-[11px] text-muted">
                  {formatBytes(file.size)}
                </span>
                <button
                  type="button"
                  aria-label={`${file.name} 제거`}
                  title="첨부 파일 제거"
                  onClick={() =>
                    setAttachments((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  className="rounded p-1 text-muted hover:bg-red-500/10 hover:text-red-600"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        </fieldset>
        {uploadProgress && (
          <div>
            <div className="flex justify-between text-xs text-muted">
              <span className="truncate">{uploadProgress.name}</span>
              <span>{uploadProgress.percent}%</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-line">
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${uploadProgress.percent}%` }}
              />
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>
            취소
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? <Spinner /> : "작업 생성"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function AssigneeStack({ task }: { task: Task }) {
  const assignees = task.task_assignees ?? [];
  if (!assignees.length)
    return <span className="text-[11px] text-muted">미배정</span>;
  return (
    <div className="flex -space-x-2">
      {assignees.slice(0, 2).map((assignee) => (
        <Avatar
          key={assignee.user_id}
          name={assignee.profile?.name ?? "팀원"}
          url={assignee.profile?.avatar_url}
          size="sm"
          className="ring-2 ring-surface"
        />
      ))}
      {assignees.length > 2 && (
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-raised text-[10px] font-bold text-muted ring-2 ring-surface">
          +{assignees.length - 2}
        </span>
      )}
    </div>
  );
}

const nextTaskStatus: Record<TaskStatus, TaskStatus> = {
  todo: "in_progress",
  in_progress: "review",
  review: "done",
  done: "todo",
};

export function DraggableTaskCard({ task }: { task: Task }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const drag = useDraggable({ id: task.id, data: { status: task.status } });
  const statusMutation = useMutation({
    mutationFn: async () => {
      const status = nextTaskStatus[task.status];
      await updateTask(task, { status });
      return status;
    },
    onSuccess: async (status) => {
      queryClient.setQueryData<Task[]>(["tasks", task.project_id], (current = []) =>
        current.map((item) => item.id === task.id
          ? { ...item, status, revision: item.revision + 1 }
          : item),
      );
      showToast(`작업 상태가 ${taskStatusLabels[status]}(으)로 변경되었습니다.`, { tone: "success" });
      await queryClient.invalidateQueries({ queryKey: ["tasks", task.project_id] });
    },
    onError: () => showToast("작업 상태를 변경하지 못했습니다.", { tone: "error" }),
  });
  const remove = async () => {
    if (!window.confirm(`"${task.title}" 작업을 삭제할까요?`)) return;
    try {
      await deleteTask(task.id);
      queryClient.setQueryData<Task[]>(["tasks", task.project_id], (current = []) =>
        current.filter((item) => item.id !== task.id),
      );
      showToast("작업이 삭제되었습니다.", { tone: "success" });
      await queryClient.invalidateQueries({ queryKey: ["tasks", task.project_id] });
    } catch {
      showToast("작업을 삭제하지 못했습니다.", { tone: "error" });
    }
  };
  const transform = drag.transform
    ? `translate3d(${drag.transform.x}px, ${drag.transform.y}px, 0) scale(1.018)`
    : undefined;
  return (
    <article
      ref={drag.setNodeRef}
      style={{ transform }}
      {...drag.listeners}
      {...drag.attributes}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button, a, input, select, textarea, [role='menuitem']")) return;
        if (!drag.isDragging) navigate(`/tasks/${task.id}`);
      }}
      className={cn(
        "task-card cursor-grab rounded-xl border p-3.5 active:cursor-grabbing",
        drag.isDragging && "layer-drag opacity-80",
      )}
      data-dragging={drag.isDragging}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <Badge
          tone={
            task.priority === "urgent"
              ? "red"
              : task.priority === "high"
                ? "amber"
                : "neutral"
          }
        >
          {taskPriorityLabels[task.priority]}
        </Badge>
        <div
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <Popover
            label={`${task.title} 작업 메뉴`}
            role="menu"
            className="w-40 p-1"
            trigger={(triggerProps) => (
              <button
                {...triggerProps}
                type="button"
                aria-label={`${task.title} 작업 메뉴`}
                title="작업 메뉴"
                className="rounded-lg p-1.5 text-muted transition hover:bg-raised hover:text-ink"
              >
                <MoreHorizontal size={16} />
              </button>
            )}
          >
            {(close) => (
              <>
                <button role="menuitem" className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-raised" onClick={() => { close(); navigate(`/tasks/${task.id}`); }}>
                  작업 열기
                </button>
                <button role="menuitem" className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-raised" onClick={() => { close(); navigate(`/tasks/${task.id}`); }}>
                  수정
                </button>
                <button role="menuitem" className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-raised disabled:opacity-50" disabled={statusMutation.isPending} onClick={() => { close(); statusMutation.mutate(); }}>
                  {taskStatusLabels[nextTaskStatus[task.status]]}(으)로 이동
                </button>
                <button role="menuitem" className="w-full rounded-lg px-3 py-2 text-left text-xs text-red-600 hover:bg-red-500/10" onClick={() => { close(); void remove(); }}>
                  <span className="flex items-center gap-2"><Trash2 size={13} /> 삭제</span>
                </button>
              </>
            )}
          </Popover>
        </div>
      </div>
      <h3 className="text-sm font-bold leading-5 text-ink">{task.title}</h3>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-brand"
          style={{ width: `${task.progress}%` }}
        />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <AssigneeStack task={task} />
        <div className="flex items-center gap-2 text-[10px] text-muted">
          {task.due_date && (
            <span>
              {new Date(`${task.due_date}T00:00:00`).toLocaleDateString(
                "ko-KR",
                { month: "short", day: "numeric" },
              )}
            </span>
          )}
              <span className="flex items-center gap-1">
                <MessageSquare size={12} />
                {task.comments?.[0]?.count ?? 0}
              </span>
              <span className="flex items-center gap-1"><Paperclip size={12} />{task.files?.[0]?.count ?? 0}</span>
        </div>
      </div>
    </article>
  );
}

function BoardColumn({ status, tasks }: { status: TaskStatus; tasks: Task[] }) {
  const drop = useDroppable({ id: status });
  return (
    <section
      ref={drop.setNodeRef}
      className={cn(
        "board-column min-h-[520px] rounded-2xl border p-3 transition",
      )}
      data-drop-active={drop.isOver}
    >
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              status === "todo"
                ? "bg-slate-400"
                : status === "in_progress"
                  ? "bg-blue-500"
                  : status === "review"
                    ? "bg-violet-500"
                    : "bg-emerald-500",
            )}
          />
          <h2 className="text-xs font-extrabold uppercase tracking-wide text-ink">
            {statusLabel(status)}
          </h2>
        </div>
        <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-bold text-muted">
          {tasks.length}
        </span>
      </div>
      <div className="space-y-2.5">
        {tasks.map((task) => (
          <DraggableTaskCard key={task.id} task={task} />
        ))}
      </div>
    </section>
  );
}

export function BoardPage() {
  const { project } = useProjectContext();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const { showToast } = useToast();
  const tasks = useQuery({
    queryKey: ["tasks", project.id],
    queryFn: () => listTasks(project.id),
  });
  const members = useQuery({
    queryKey: ["members", project.id],
    queryFn: () => listProjectMembers(project.id),
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [search, setSearch] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const visible = (tasks.data ?? []).filter(
    (task) =>
      (scope === "all" ||
        task.task_assignees?.some((item) => item.user_id === user?.id)) &&
      (!search ||
        `${task.title} ${task.description ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  const onDragEnd = async (event: DragEndEvent) => {
    const targetStatus = event.over?.id as TaskStatus | undefined;
    const task = tasks.data?.find((item) => item.id === event.active.id);
    if (
      !task ||
      !targetStatus ||
      task.status === targetStatus ||
      !["todo", "in_progress", "review", "done"].includes(targetStatus)
    )
      return;
    const previous = tasks.data;
    queryClient.setQueryData<Task[]>(["tasks", project.id], (current = []) =>
      current.map((item) =>
        item.id === task.id
          ? { ...item, status: targetStatus, revision: item.revision + 1 }
          : item,
      ),
    );
    try {
      await updateTask(task, { status: targetStatus });
      showToast("작업 상태가 변경되었습니다.", {
        tone: "success",
        dedupeKey: `task-moved:${task.id}:${targetStatus}`,
      });
    } catch (error) {
      queryClient.setQueryData(["tasks", project.id], previous);
      showToast(error instanceof Error ? error.message : "작업을 이동하지 못했습니다.", {
        tone: "error",
        dedupeKey: `task-move-failed:${task.id}`,
      });
    } finally {
      await queryClient.invalidateQueries({ queryKey: ["tasks", project.id] });
    }
  };
  return (
    <div className="page-wrap max-w-none">
      <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">보드</h1>
          <p className="mt-1 text-sm text-muted">
            카드를 드래그해 상태를 변경합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="segmented-control">
            <button
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold",
                scope === "all" ? "bg-surface text-brand shadow-sm" : "text-muted hover:text-ink",
              )}
              onClick={() => setScope("all")}
            >
              전체 작업
            </button>
            <button
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold",
                scope === "mine" ? "bg-surface text-brand shadow-sm" : "text-muted hover:text-ink",
              )}
              onClick={() => setScope("mine")}
            >
              내 작업
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-muted" size={15} />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-10 w-52 pl-9"
              placeholder="작업 검색"
            />
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={16} /> 새 작업
          </Button>
        </div>
      </div>
      {tasks.error ? (
        <Alert>보드를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. <Button size="sm" variant="ghost" onClick={() => void tasks.refetch()}>다시 시도</Button></Alert>
      ) : tasks.isLoading ? (
        <Spinner />
      ) : (
        <DndContext
          sensors={sensors}
          onDragEnd={(event) => void onDragEnd(event)}
        >
          <div className="scrollbar-thin overflow-x-auto pb-4">
            <div className="grid min-w-[980px] grid-cols-4 gap-3">
              {(["todo", "in_progress", "review", "done"] as TaskStatus[]).map(
                (status) => (
                  <BoardColumn
                    key={status}
                    status={status}
                    tasks={visible.filter((task) => task.status === status)}
                  />
                ),
              )}
            </div>
          </div>
        </DndContext>
      )}
      <TaskFormDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        projectId={project.id}
        members={members.data ?? []}
      />
    </div>
  );
}

export function TaskListPage() {
  const { project } = useProjectContext();
  const tasks = useQuery({
    queryKey: ["tasks", project.id],
    queryFn: () => listTasks(project.id),
  });
  const [search, setSearch] = useState("");
  const filtered = useMemo(
    () =>
      (tasks.data ?? []).filter((task) =>
        `${task.title} ${task.description ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [tasks.data, search],
  );
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="작업"
        title="전체 작업"
        description="프로젝트 작업의 상태와 담당자를 한눈에 확인합니다."
        action={
          <div className="relative">
            <Search size={15} className="absolute left-3 top-3 text-muted" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
              placeholder="제목·설명 검색"
            />
          </div>
        }
      />
      {tasks.error ? (
        <Alert>작업을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. <Button size="sm" variant="ghost" onClick={() => void tasks.refetch()}>다시 시도</Button></Alert>
      ) : tasks.isLoading ? (
        <Spinner />
      ) : filtered.length ? (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="clean-table w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-line bg-raised text-xs text-muted">
                <tr>
                  <th className="px-4 py-3">작업</th>
                  <th className="px-4 py-3">상태</th>
                  <th className="px-4 py-3">담당자</th>
                  <th className="px-4 py-3">진행률</th>
                  <th className="px-4 py-3">마감</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((task) => (
                  <tr key={task.id} className="hover:bg-raised">
                    <td className="px-4 py-3">
                      <Link
                        to={`/tasks/${task.id}`}
                        className="font-semibold text-ink hover:text-brand"
                      >
                        {task.title}
                      </Link>
                      <div className="mt-0.5 max-w-md truncate text-xs text-muted">
                        {task.description}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone(task.status)}>
                        {statusLabel(task.status)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <AssigneeStack task={task} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 rounded-full bg-line">
                          <div
                            className="h-full rounded-full bg-brand"
                            style={{ width: `${task.progress}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold">
                          {task.progress}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {task.due_date ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState icon={<ListTodo />} title="작업이 없습니다" description={search ? "검색 조건에 맞는 작업이 없습니다." : "새 작업을 만들어 프로젝트를 시작해 보세요."} />
      )}
    </div>
  );
}
