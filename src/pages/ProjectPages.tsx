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
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  Settings,
  ShieldAlert,
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
  useNavigate,
  useOutletContext,
  useParams,
} from "react-router-dom";
import { useProjectRealtime } from "../hooks/useProjectRealtime";
import { cn } from "../lib/utils";
import { getProject, listProjectMembers } from "../services/projects";
import { listActivities } from "../services/activity";
import { createTask, listTasks, updateTask } from "../services/tasks";
import { uploadProjectFile } from "../services/files";
import { MAX_FILE_SIZE_LABEL, validateProjectFile } from "../lib/filePolicy";
import {
  activityLabel,
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
  Spinner,
  StatCard,
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
  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId!),
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
      <div className="border-b border-line bg-surface">
        <div className="mx-auto max-w-[1500px] px-4 pt-5 sm:px-6 lg:px-8">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand/10 text-lg font-extrabold text-brand">
                {project.data.name[0]}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-extrabold text-ink">
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
                <p className="mt-0.5 text-xs text-muted">Team Rocket 프로젝트 워크스페이스</p>
              </div>
            </div>
          </div>
          <nav className="scrollbar-thin mt-5 flex gap-1 overflow-x-auto pb-0">
            {projectNav.map(([path, label, Icon]) => (
                <NavLink
                  end={path === ""}
                  key={path}
                  to={`/projects/${projectId}${path ? `/${path}` : ""}`}
                  className={({ isActive }) =>
                    cn(
                      "flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-xs font-semibold transition",
                      isActive
                        ? "border-brand text-brand"
                        : "border-transparent text-muted hover:text-ink",
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

export function ProjectOverviewPage() {
  const { project } = useProjectContext();
  const tasks = useQuery({
    queryKey: ["tasks", project.id],
    queryFn: () => listTasks(project.id),
  });
  const members = useQuery({
    queryKey: ["members", project.id],
    queryFn: () => listProjectMembers(project.id),
  });
  const activities = useQuery({
    queryKey: ["activities", project.id],
    queryFn: () => listActivities(project.id),
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
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="프로젝트 개요"
        title="프로젝트 현황"
        description={project.description ?? "프로젝트 설명이 없습니다."}
      />
      <section className="panel mb-4 p-5">
        <div className="flex items-center justify-between text-sm"><h2 className="font-extrabold text-ink">프로젝트 진행률</h2><strong className="text-brand">{projectProgress(list)}%</strong></div>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-brand transition-all" style={{ width: `${projectProgress(list)}%` }} /></div>
      </section>
      {tasks.error || members.error || activities.error ? (
        <Alert>프로젝트 현황을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</Alert>
      ) : tasks.isLoading ? (
        <Spinner />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard
              label="전체 작업"
              value={list.length}
              icon={<CheckSquare size={18} />}
            />
            <StatCard
              label="완료"
              value={list.filter((task) => task.status === "done").length}
              icon={<CheckSquare size={18} />}
            />
            <StatCard
              label="진행 중"
              value={list.filter((task) => task.status === "in_progress" || task.status === "review").length}
              icon={<CircleDot size={18} />}
            />
            <StatCard
              label="할 일"
              value={list.filter((task) => task.status === "todo").length}
              icon={<Clock3 size={18} />}
            />
            <StatCard label="지연" value={overdue.length} icon={<AlertTriangle size={18} />} />
          </div>
          <div className="mt-6 grid gap-5 xl:grid-cols-[1.5fr_1fr]">
            <section className="panel p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-extrabold text-ink">최근 작업</h2>
                <Link
                  to={`/projects/${project.id}/board`}
                  className="text-xs font-semibold text-brand"
                >
                  보드 보기
                </Link>
              </div>
              <div className="mt-4 space-y-2">
                {list.slice(0, 6).map((task) => (
                  <Link
                    key={task.id}
                    to={`/tasks/${task.id}`}
                    className="flex items-center gap-3 rounded-xl border border-line p-3 hover:bg-raised"
                  >
                    <Badge tone={statusTone(task.status)}>
                      {statusLabel(task.status)}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                      {task.title}
                    </span>
                    <span className="text-xs font-bold text-muted">
                      {task.progress}%
                    </span>
                  </Link>
                ))}
                {list.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted">
                    아직 작업이 없습니다.
                  </p>
                )}
              </div>
            </section>
            <section className="panel p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-extrabold text-ink">팀원</h2>
                <Link
                  to={`/projects/${project.id}/team`}
                  className="text-xs font-semibold text-brand"
                >
                  관리
                </Link>
              </div>
              <div className="mt-4 space-y-3">
                {members.data?.map((member) => (
                  <div key={member.user_id} className="flex items-center gap-3">
                    <Avatar
                      name={member.profile?.name ?? "팀원"}
                      url={member.profile?.avatar_url}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-ink">
                        {member.profile?.name}
                      </div>
                      <div className="text-[11px] text-muted">
                        {member.profile?.student_id}
                      </div>
                    </div>
                    <Badge
                      tone={member.role === "owner" ? "purple" : "neutral"}
                    >
                      {projectRoleLabels[member.role]}
                    </Badge>
                  </div>
                ))}
              </div>
            </section>
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <section className="panel p-5">
              <div className="flex items-center justify-between"><h2 className="font-extrabold text-ink">내 작업</h2><Link to="/my-tasks" className="text-xs font-semibold text-brand">전체 보기</Link></div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center"><div className="subtle-panel p-3"><strong className="block text-lg text-ink">{myTasks.filter((task) => inDays(task) === 0 && task.status !== "done").length}</strong><span className="text-[10px] text-muted">오늘</span></div><div className="subtle-panel p-3"><strong className="block text-lg text-ink">{myTasks.filter((task) => inDays(task) !== null && inDays(task)! >= 0 && inDays(task)! <= 7 && task.status !== "done").length}</strong><span className="text-[10px] text-muted">이번 주</span></div><div className="subtle-panel p-3"><strong className="block text-lg text-red-600">{myTasks.filter((task) => task.status !== "done" && inDays(task) !== null && inDays(task)! < 0).length}</strong><span className="text-[10px] text-muted">지연</span></div></div>
              <div className="mt-3 space-y-2">{importantMine.map((task) => <Link key={task.id} to={`/tasks/${task.id}`} className="flex items-center gap-3 rounded-xl border border-line p-3 hover:bg-raised"><span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{task.title}</span><Badge tone={inDays(task) !== null && inDays(task)! < 0 ? "red" : inDays(task) === 0 ? "amber" : "neutral"}>{inDays(task) === null ? "마감 없음" : inDays(task)! < 0 ? `${Math.abs(inDays(task)!)}일 지연` : inDays(task) === 0 ? "오늘 마감" : `${inDays(task)}일 남음`}</Badge></Link>)}</div>
            </section>
            <section className="panel p-5">
              <div className="flex items-center justify-between"><h2 className="font-extrabold text-ink">마감 임박</h2><Link to={`/projects/${project.id}/calendar`} className="text-xs font-semibold text-brand">캘린더 보기</Link></div>
              <div className="mt-3 space-y-2">{dueSoon.map((task) => <Link key={task.id} to={`/tasks/${task.id}`} className="flex items-center gap-3 rounded-xl border border-line p-3 hover:bg-raised"><span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{task.title}</span><span className={`text-xs font-bold ${inDays(task)! < 0 ? "text-red-600" : "text-muted"}`}>{inDays(task)! < 0 ? `${Math.abs(inDays(task)!)}일 지연` : inDays(task) === 0 ? "오늘" : inDays(task) === 1 ? "내일" : `${inDays(task)}일 이내`}</span></Link>)}{!dueSoon.length && <p className="py-6 text-center text-sm text-muted">3일 이내 마감 작업이 없습니다.</p>}</div>
            </section>
            <section className="panel p-5">
              <div className="flex items-center justify-between"><h2 className="font-extrabold text-ink">최근 활동</h2><Link to={`/projects/${project.id}/activity`} className="text-xs font-semibold text-brand">전체 보기</Link></div>
              <div className="mt-3 space-y-3">{activities.data?.slice(0, 6).map((activity) => <div key={activity.id} className="flex gap-3"><Avatar name={activity.actor?.name ?? "시스템"} url={activity.actor?.avatar_url} size="sm" /><div><p className="text-sm text-ink"><strong>{activity.actor?.name ?? "시스템"}</strong>님이 {activityLabel(activity.action)}</p><p className="mt-0.5 text-[10px] text-muted">{new Date(activity.created_at).toLocaleString("ko-KR")}</p></div></div>)}</div>
            </section>
            <section className="panel p-5">
              <div className="flex items-center justify-between"><h2 className="font-extrabold text-ink">팀 현황</h2><Link to={`/projects/${project.id}/team`} className="text-xs font-semibold text-brand">팀 보기</Link></div>
              <div className="mt-3 space-y-3">{members.data?.slice(0, 8).map((member) => { const assigned = list.filter((task) => task.task_assignees?.some((assignee) => assignee.user_id === member.user_id)); const done = assigned.filter((task) => task.status === "done").length; return <div key={member.user_id} className="flex items-center gap-3"><Avatar name={member.profile?.name ?? "팀원"} url={member.profile?.avatar_url} size="sm" /><span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{member.profile?.name}</span><span className="text-xs text-muted">완료 <strong className="text-ink">{done}</strong> / 전체 <strong className="text-ink">{assigned.length}</strong></span></div>; })}</div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function TaskFormDialog({
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
  const [partialMessage, setPartialMessage] = useState("");
  const reset = () => {
    setTitle("");
    setDescription("");
    setAssigneeIds([]);
    setAttachments([]);
    setFileError("");
    setPartialMessage("");
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
    onSuccess: async ({ failed, total }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tasks", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["files", projectId] }),
      ]);
      setUploadProgress(null);
      if (failed)
        setPartialMessage(
          `작업은 생성되었습니다. ${total}개 파일 중 ${failed}개 업로드에 실패했습니다.`,
        );
      else close();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!partialMessage) mutation.mutate();
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
        {mutation.error && (
          <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-600">
            {mutation.error.message}
          </div>
        )}
        {partialMessage && (
          <div className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-700">
            {partialMessage}
          </div>
        )}
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
            disabled={Boolean(partialMessage)}
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
            disabled={Boolean(partialMessage)}
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
              disabled={Boolean(partialMessage)}
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
              disabled={Boolean(partialMessage)}
            />
          </div>
        </div>
        <fieldset disabled={Boolean(partialMessage)}>
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
        <fieldset disabled={mutation.isPending || Boolean(partialMessage)}>
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
            {partialMessage ? "닫기" : "취소"}
          </Button>
          {!partialMessage && (
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Spinner /> : "작업 생성"}
            </Button>
          )}
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

function DraggableTaskCard({ task }: { task: Task }) {
  const navigate = useNavigate();
  const drag = useDraggable({ id: task.id, data: { status: task.status } });
  const transform = drag.transform
    ? `translate3d(${drag.transform.x}px, ${drag.transform.y}px, 0)`
    : undefined;
  return (
    <article
      ref={drag.setNodeRef}
      style={{ transform }}
      {...drag.listeners}
      {...drag.attributes}
      onClick={() => {
        if (!drag.isDragging) navigate(`/tasks/${task.id}`);
      }}
      className={cn(
        "cursor-grab rounded-xl border border-line bg-surface p-3.5 shadow-sm transition hover:border-brand/30 hover:shadow-md active:cursor-grabbing",
        drag.isDragging && "z-50 opacity-70 shadow-lift",
      )}
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
        <MoreHorizontal size={15} className="text-muted" />
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
        "min-h-[520px] rounded-2xl border border-line bg-raised/65 p-3 transition",
        drop.isOver && "border-brand bg-brand/5",
      )}
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
    } catch {
      queryClient.setQueryData(["tasks", project.id], previous);
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
          <div className="flex rounded-xl border border-line bg-surface p-1">
            <button
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold",
                scope === "all" ? "bg-brand text-white" : "text-muted",
              )}
              onClick={() => setScope("all")}
            >
              전체 작업
            </button>
            <button
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold",
                scope === "mine" ? "bg-brand text-white" : "text-muted",
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
          <div className="grid min-w-[980px] grid-cols-4 gap-3 overflow-x-auto pb-4">
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
            <table className="w-full min-w-[760px] text-left text-sm">
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
