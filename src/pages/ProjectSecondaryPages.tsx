import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ko } from "date-fns/locale";
import {
  Archive,
  Download,
  ExternalLink,
  File,
  Folder,
  FolderPlus,
  Github,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserMinus,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { listProjectActivities } from "../services/activity";
import {
  deleteProjectFile,
  downloadProjectFile,
  createFileFolder,
  listFileFolders,
  listFiles,
  moveProjectFile,
  uploadProjectFile,
} from "../services/files";
import {
  addProjectMember,
  deleteProject,
  getGitHubRepositoryStatus,
  listProjectMembers,
  removeProjectMember,
  retryGitHubRepositoryCreation,
  rewrapProjectMemberKey,
  searchProfiles,
  updateProject,
} from "../services/projects";
import { listTasks, updateTask } from "../services/tasks";
import { useAuthStore } from "../stores/authStore";
import type {
  Profile,
  ProjectFile,
  ProjectMember,
  ProjectRole,
  Task,
} from "../types/domain";
import { formatBytes } from "../lib/utils";
import { MAX_FILE_SIZE_LABEL } from "../lib/filePolicy";
import { activityLabel, activityTargetLabel, githubErrorMessage, githubSyncStatusLabels, projectRoleLabels, taskStatusLabels } from "../lib/display";
import { useProjectContext } from "./ProjectPages";
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
  useToast,
} from "../components/ui";
import { useProjectKeyStore } from "../stores/projectKeyStore";
import { usePermissions } from "../hooks/usePermissions";
import { ADMIN_PERMISSIONS } from "../../supabase/functions/_shared/adminPermissions";

export function ProjectCalendarPage() {
  const { project } = useProjectContext();
  const queryClient = useQueryClient();
  const tasks = useQuery({
    queryKey: ["tasks", project.id],
    queryFn: () => listTasks(project.id),
  });
  const [mode, setMode] = useState<"month" | "week" | "agenda">("month");
  const [cursor, setCursor] = useState(new Date());
  const monthDays = eachDayOfInterval({
    start: startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 }),
    end: endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 }),
  });
  const weekDays = eachDayOfInterval({
    start: startOfWeek(cursor, { weekStartsOn: 0 }),
    end: endOfWeek(cursor, { weekStartsOn: 0 }),
  });
  const dated = (tasks.data ?? []).filter(
    (task) => task.start_date || task.due_date,
  );
  const today = format(new Date(), "yyyy-MM-dd");
  const overdue = dated.filter((task) => task.due_date && task.due_date < today && task.status !== "done");
  const thisWeek = dated.filter((task) => task.due_date && task.due_date >= today && task.due_date <= format(addDays(new Date(), 7), "yyyy-MM-dd") && task.status !== "done");
  const moveTask = async (taskId: string, date: Date) => {
    const task = tasks.data?.find((item) => item.id === taskId);
    if (!task) return;
    await updateTask(task, { due_date: format(date, "yyyy-MM-dd") });
    await queryClient.invalidateQueries({ queryKey: ["tasks", project.id] });
  };
  const taskPill = (task: Task) => (
    <button
      key={task.id}
      draggable
      onDragStart={(event) =>
        event.dataTransfer.setData("text/task-id", task.id)
      }
      className={`mb-1 block w-full truncate rounded-md px-1.5 py-1 text-left text-[10px] font-semibold ${task.due_date && task.due_date < today && task.status !== "done" ? "bg-red-500/10 text-red-600" : "bg-brand/10 text-brand"}`}
    >
      {task.title}
    </button>
  );
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="캘린더"
        title="프로젝트 일정"
        description={`오늘 마감 ${dated.filter((task) => task.due_date === today && task.status !== "done").length}개 · 이번 주 ${thisWeek.length}개 · 지연 ${overdue.length}개`}
        action={
          <div className="segmented-control">
            {(["month", "week", "agenda"] as const).map((item) => (
              <button
                key={item}
                onClick={() => setMode(item)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${mode === item ? "bg-surface text-brand shadow-sm" : "text-muted hover:text-ink"}`}
              >
                {item === "month"
                  ? "월"
                  : item === "week"
                    ? "주"
                    : "일정 목록"}
              </button>
            ))}
          </div>
        }
      />
      {tasks.error ? (
        <Alert>일정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. <Button size="sm" variant="ghost" onClick={() => void tasks.refetch()}>다시 시도</Button></Alert>
      ) : tasks.isLoading ? (
        <Spinner />
      ) : (
        <div className="panel calendar-surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-line p-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setCursor(
                  mode === "month" ? addDays(cursor, -30) : addDays(cursor, -7),
                )
              }
            >
              이전
            </Button>
            <h2 className="font-extrabold text-ink">
              {format(cursor, "yyyy년 M월", { locale: ko })}
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setCursor(
                  mode === "month" ? addDays(cursor, 30) : addDays(cursor, 7),
                )
              }
            >
              다음
            </Button>
          </div>
          {mode === "month" && (
            <div className="grid grid-cols-7">
              {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
                <div
                  key={day}
                  className="border-b border-r border-line/70 bg-raised/50 p-2 text-center text-[10px] font-bold text-muted"
                >
                  {day}
                </div>
              ))}
              {monthDays.map((day) => (
                <div
                  key={day.toISOString()}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) =>
                    void moveTask(
                      event.dataTransfer.getData("text/task-id"),
                      day,
                    )
                  }
                  className={`min-h-28 border-b border-r border-line/70 p-1.5 transition hover:bg-brand/[.025] ${isSameMonth(day, cursor) ? "bg-surface/55" : "bg-raised/25 text-muted"}`}
                >
                  <div
                    className={`mb-1 text-[11px] ${isSameDay(day, new Date()) ? "flex h-5 w-5 items-center justify-center rounded-full bg-brand font-bold text-white" : "text-muted"}`}
                  >
                    {format(day, "d")}
                  </div>
                  {dated
                    .filter((task) =>
                      isSameDay(
                        parseISO(task.due_date ?? task.start_date!),
                        day,
                      ),
                    )
                    .slice(0, 3)
                    .map(taskPill)}
                </div>
              ))}
            </div>
          )}
          {mode === "week" && (
            <div className="grid grid-cols-7">
              {weekDays.map((day) => (
                <div
                  key={day.toISOString()}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) =>
                    void moveTask(
                      event.dataTransfer.getData("text/task-id"),
                      day,
                    )
                  }
                  className="min-h-[420px] border-r border-line p-2"
                >
                  <div className="mb-4 text-center">
                    <div className="text-[10px] font-bold text-muted">
                      {format(day, "EEE", { locale: ko })}
                    </div>
                    <div className="mt-1 text-lg font-extrabold text-ink">
                      {format(day, "d")}
                    </div>
                  </div>
                  {dated
                    .filter((task) =>
                      isSameDay(
                        parseISO(task.due_date ?? task.start_date!),
                        day,
                      ),
                    )
                    .map(taskPill)}
                </div>
              ))}
            </div>
          )}
          {mode === "agenda" && (
            <div className="divide-y divide-line">
              {dated
                .sort((a, b) =>
                  (a.due_date ?? a.start_date ?? "").localeCompare(
                    b.due_date ?? b.start_date ?? "",
                  ),
                )
                .map((task) => (
                  <div key={task.id} className="flex items-center gap-4 p-4">
                    <div className="w-24 text-xs font-bold text-brand">
                      {task.due_date ?? task.start_date}
                    </div>
                    <div className="flex-1 text-sm font-semibold text-ink">
                      {task.title}
                    </div>
                    <Badge>{taskStatusLabels[task.status]}</Badge>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ProjectFilesPage() {
  const { project } = useProjectContext();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const { showToast } = useToast();
  const members = useQuery({
    queryKey: ["members", project.id],
    queryFn: () => listProjectMembers(project.id),
  });
  const role = members.data?.find((member) => member.user_id === user?.id)?.role;
  const files = useQuery({
    queryKey: ["files", project.id],
    queryFn: () => listFiles(project.id),
  });
  const folders = useQuery({
    queryKey: ["file-folders", project.id],
    queryFn: () => listFileFolders(project.id),
  });
  const [folderId, setFolderId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [uploader, setUploader] = useState("all");
  const [fileType, setFileType] = useState("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "name">("newest");
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [progress, setProgress] = useState<{
    phase: string;
    percent: number;
    name: string;
  } | null>(null);
  const [preview, setPreview] = useState<{
    file: ProjectFile;
    url: string;
    text?: string | undefined;
  } | null>(null);
  const createFolder = useMutation({
    mutationFn: () => createFileFolder(project.id, folderName),
    onSuccess: async () => {
      setFolderName("");
      setFolderOpen(false);
      showToast("폴더가 생성되었습니다.", { tone: "success" });
      await queryClient.invalidateQueries({ queryKey: ["file-folders", project.id] });
    },
    onError: () => showToast("폴더를 생성하지 못했습니다.", { tone: "error" }),
  });
  const visibleFiles = [...(files.data ?? [])]
    .filter((file) => folderId === "all" || (folderId === "root" ? !file.folder_id : file.folder_id === folderId))
    .filter((file) => !search.trim() || (file.filename ?? "").toLowerCase().includes(search.trim().toLowerCase()))
    .filter((file) => uploader === "all" || file.uploaded_by === uploader)
    .filter((file) => fileType === "all" || file.mime_type.split("/")[0] === fileType)
    .sort((left, right) => sort === "name" ? (left.filename ?? "").localeCompare(right.filename ?? "", "ko") : sort === "oldest" ? left.created_at.localeCompare(right.created_at) : right.created_at.localeCompare(left.created_at));
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  const upload = async (file: File) => {
    setProgress({ phase: "encrypting", percent: 0, name: file.name });
    try {
      await uploadProjectFile(
        project.id,
        file,
        undefined,
        (phase, percent) => setProgress({ phase, percent, name: file.name }),
        folderId === "all" || folderId === "root" ? undefined : folderId,
      );
      await queryClient.invalidateQueries({ queryKey: ["files", project.id] });
      showToast("파일이 업로드되었습니다.", { tone: "success" });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "파일을 업로드하지 못했습니다.", { tone: "error" });
    } finally {
      setProgress(null);
    }
  };
  const download = async (item: ProjectFile, asPreview = false) => {
    const blob = await downloadProjectFile(item);
    const url = URL.createObjectURL(blob);
    if (
      asPreview &&
      /^(image\/|text\/|application\/pdf|application\/json)/u.test(
        item.mime_type,
      )
    ) {
      const text = /^(text\/|application\/json)/u.test(item.mime_type)
        ? await blob.text()
        : undefined;
      setPreview({ file: item, url, text });
    } else {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.filename ?? "download";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="파일"
        title="파일"
        description="프로젝트에 필요한 파일을 폴더별로 업로드하고 관리합니다."
        action={role !== "viewer" ? (
          <label className="ui-button ui-button--primary inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl px-4 text-sm font-semibold text-white">
            <Upload size={16} /> 파일 업로드
            <input
              type="file"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
        ) : undefined}
      />
      <div className="panel mb-4 p-4">
        <p className="mb-3 text-xs text-muted">파일당 최대 {MAX_FILE_SIZE_LABEL} · 실행 파일 제외</p>
        <div className="flex flex-wrap items-center gap-2">
          {role !== "viewer" && <Button variant="secondary" size="sm" onClick={() => setFolderOpen(true)}><FolderPlus size={14} /> 새 폴더</Button>}
          <div className="relative min-w-48 flex-1"><Search className="absolute left-3 top-2.5 text-muted" size={15} /><Input className="h-9 pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="파일 이름 검색" /></div>
          <select className="field h-9 w-auto text-xs" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="newest">최신 업로드</option><option value="oldest">오래된 업로드</option><option value="name">이름순</option></select>
          <select className="field h-9 w-auto text-xs" value={uploader} onChange={(event) => setUploader(event.target.value)}><option value="all">모든 업로더</option>{[...new Map((files.data ?? []).filter((file) => file.uploaded_by).map((file) => [file.uploaded_by!, file.uploader?.name ?? "사용자"])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
          <select className="field h-9 w-auto text-xs" value={fileType} onChange={(event) => setFileType(event.target.value)}><option value="all">모든 유형</option><option value="image">이미지</option><option value="text">텍스트</option><option value="application">문서/데이터</option></select>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          <button className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold ${folderId === "all" ? "bg-brand text-white" : "bg-raised text-muted"}`} onClick={() => setFolderId("all")}>전체</button>
          <button className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold ${folderId === "root" ? "bg-brand text-white" : "bg-raised text-muted"}`} onClick={() => setFolderId("root")}>폴더 없음</button>
          {folders.data?.map((folder) => <button key={folder.id} className={`flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold ${folderId === folder.id ? "bg-brand text-white" : "bg-raised text-muted"}`} onClick={() => setFolderId(folder.id)}><Folder size={13} /> {folder.name}</button>)}
        </div>
      </div>
      {progress && (
        <div className="panel mb-4 p-4">
          <div className="flex justify-between text-xs">
            <span className="font-semibold text-ink">
              {progress.name} ·{" "}
              {progress.phase === "encrypting" ? "암호화 중" : "업로드 중"}
            </span>
            <span className="text-muted">{progress.percent}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-line">
            <div
              className="h-full bg-brand"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      )}
      {files.error || folders.error ? (
        <Alert>파일을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. <Button size="sm" variant="ghost" onClick={() => { void files.refetch(); void folders.refetch(); }}>다시 시도</Button></Alert>
      ) : files.isLoading || folders.isLoading ? (
        <Spinner />
      ) : visibleFiles.length ? (
        <div className="panel divide-y divide-line/70 overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_5rem_minmax(7rem,1fr)_7rem_auto] gap-3 bg-raised/45 px-4 py-3 text-xs font-semibold text-muted xl:grid">
            <span>파일명</span><span>폴더</span><span>연결된 작업</span><span>크기</span><span>업로더</span><span>업로드 날짜</span><span className="text-right">메뉴</span>
          </div>
          {visibleFiles.map((file) => (
            <div
              key={file.id}
              className="grid gap-3 p-4 transition hover:bg-brand/[.025] xl:grid-cols-[minmax(0,2fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_5rem_minmax(7rem,1fr)_7rem_auto] xl:items-center"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                  <File size={19} />
                </div>
                <div className="min-w-0">
                  <button className="block max-w-full truncate text-left text-sm font-bold text-ink hover:text-brand" title={file.filename} onClick={() => void download(file, true)}>{file.filename}</button>
                  <p className="mt-1 text-[11px] text-muted xl:hidden">{formatBytes(file.original_size)} · {file.uploader?.name ?? "사용자"} · {new Date(file.created_at).toLocaleDateString("ko-KR")}</p>
                </div>
              </div>
              <div>{file.uploaded_by === user?.id || role === "owner" || role === "admin" ? <select aria-label={`${file.filename ?? "파일"} 폴더 이동`} className="field h-8 w-full text-xs" value={file.folder_id ?? ""} onChange={async (event) => { try { await moveProjectFile(file.id, event.target.value || null); await queryClient.invalidateQueries({ queryKey: ["files", project.id] }); showToast("파일을 이동했습니다.", { tone: "success" }); } catch { showToast("파일을 이동하지 못했습니다.", { tone: "error" }); } }}><option value="">폴더 없음</option>{folders.data?.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select> : <span className="text-xs text-muted">{folders.data?.find((folder) => folder.id === file.folder_id)?.name ?? "폴더 없음"}</span>}</div>
              <div className="min-w-0 text-xs text-muted">{file.task ? <Link to={`/tasks/${file.task.id}`} className="block truncate font-semibold text-brand hover:underline">{file.task.title}</Link> : "연결된 작업 없음"}</div>
              <span className="hidden text-xs text-muted xl:block">{formatBytes(file.original_size)}</span>
              <span className="hidden truncate text-xs text-muted xl:block">{file.uploader?.name ?? "사용자"}</span>
              <span className="hidden text-xs text-muted xl:block">{new Date(file.created_at).toLocaleDateString("ko-KR")}</span>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => void download(file)}><Download size={14} /> 다운로드</Button>
                {(file.uploaded_by === user?.id || role === "owner" || role === "admin") && <Button variant="ghost" size="sm" className="text-red-600" onClick={async () => { if (confirm("파일을 삭제할까요?")) { try { await deleteProjectFile(file); await queryClient.invalidateQueries({ queryKey: ["files", project.id] }); showToast("파일이 삭제되었습니다.", { tone: "success" }); } catch { showToast("파일을 삭제하지 못했습니다.", { tone: "error" }); } } }}><Trash2 size={14} /> 삭제</Button>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Upload />}
          title="파일이 없습니다"
          description="프로젝트에 필요한 파일을 업로드해 보세요."
        />
      )}
      <Modal
        open={Boolean(preview)}
        onClose={() => {
          if (preview) URL.revokeObjectURL(preview.url);
          setPreview(null);
        }}
        title={preview?.file.filename ?? "미리보기"}
        className="max-w-4xl"
      >
        {preview?.text !== undefined ? (
          <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-xl bg-canvas p-4 text-xs text-ink">
            {preview.text}
          </pre>
        ) : preview?.file.mime_type.startsWith("image/") ? (
          <img
            src={preview.url}
            alt="복호화 파일 미리보기"
            className="mx-auto max-h-[70vh] rounded-xl object-contain"
          />
        ) : (
          preview && (
            <iframe
              src={preview.url}
              title="복호화 PDF 미리보기"
              className="h-[70vh] w-full rounded-xl border border-line"
              sandbox="allow-same-origin"
            />
          )
        )}
      </Modal>
      <Modal open={folderOpen} onClose={() => setFolderOpen(false)} title="새 폴더" description="프로젝트 파일을 정리할 폴더를 만듭니다.">
        <form onSubmit={(event) => { event.preventDefault(); createFolder.mutate(); }}><label className="label" htmlFor="folder-name">폴더 이름</label><Input id="folder-name" value={folderName} onChange={(event) => setFolderName(event.target.value)} maxLength={80} required autoFocus /><div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => setFolderOpen(false)}>취소</Button><Button type="submit" disabled={!folderName.trim() || createFolder.isPending}>만들기</Button></div></form>
      </Modal>
    </div>
  );
}

export function ProjectActivityPage() {
  const { project } = useProjectContext();
  const activities = useQuery({
    queryKey: ["activities", project.id],
    queryFn: () => listProjectActivities(project.id),
  });
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="활동"
        title="프로젝트 활동"
        description="프로젝트의 주요 변경 내용을 시간순으로 확인합니다."
      />
      {activities.error ? (
        <Alert>활동을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. <Button size="sm" variant="ghost" onClick={() => void activities.refetch()}>다시 시도</Button></Alert>
      ) : activities.isLoading ? (
        <Spinner />
      ) : activities.data?.length ? (
        <div className="activity-timeline panel overflow-hidden">
          {activities.data?.map((activity) => (
            <div key={activity.id} className="activity-item flex gap-3 border-b border-line/60 p-4 last:border-b-0">
              <Avatar
                name={activity.actor?.name ?? "시스템"}
                url={activity.actor?.avatar_url}
                size="sm"
              />
              <div>
                <p className="text-sm text-ink">
                  <strong>{activity.actor?.name ?? "시스템"}</strong>님이{" "}
                  {activityLabel(activity.action)}
                </p>
                <p className="mt-1 text-[11px] text-muted">
                  대상: {activityTargetLabel(activity.subject_type)} · {new Date(activity.created_at).toLocaleString("ko-KR")}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={<RefreshCw />} title="활동 기록이 없습니다" description="프로젝트에서 변경한 내용이 생기면 여기에 표시됩니다." />
      )}
    </div>
  );
}

function AddMemberDialog({
  open,
  onClose,
  projectId,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<Exclude<ProjectRole, "owner">>("member");
  const search = useQuery({
    queryKey: ["profile-search", query],
    queryFn: () => searchProfiles(query),
    enabled: query.trim().length >= 2,
  });
  const mutation = useMutation({
    mutationFn: (profile: Profile) =>
      addProjectMember(projectId, profile, role),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["members", projectId] });
      showToast("팀원이 추가되었습니다.", { tone: "success" });
      onClose();
    },
    onError: () => showToast("팀원을 추가하지 못했습니다.", { tone: "error" }),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="팀원 추가"
      description="학번 또는 이름으로 검색합니다. 전체 사용자 목록은 내려받지 않습니다."
    >
      <div className="relative">
        <Search className="absolute left-3 top-3 text-muted" size={16} />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="pl-9"
          placeholder="20260004 또는 최지훈"
          autoFocus
        />
      </div>
      <div className="mt-3">
        <label className="label" htmlFor="member-role">
          역할
        </label>
        <select
          id="member-role"
          className="field"
          value={role}
          onChange={(event) =>
            setRole(event.target.value as Exclude<ProjectRole, "owner">)
          }
        >
          <option value="member">팀원</option>
          <option value="admin">관리자</option>
          <option value="viewer">열람자</option>
        </select>
      </div>
      <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
        {search.data?.map((profile) => (
          <div
            key={profile.id}
            className="flex items-center gap-3 rounded-xl border border-line p-3"
          >
            <Avatar name={profile.name} url={profile.avatar_url} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ink">
                {profile.name}
              </div>
              <div className="text-[11px] text-muted">
                {profile.student_id} ·{" "}
                {profile.github_username
                  ? `@${profile.github_username}`
                  : "GitHub 계정 미연결"}
              </div>
            </div>
            <Button
              size="sm"
              disabled={mutation.isPending || !profile.encryption_public_key}
              title={
                !profile.encryption_public_key
                  ? "대상 사용자가 먼저 로그인해 보안 설정을 완료해야 합니다."
                  : undefined
              }
              onClick={() => mutation.mutate(profile)}
            >
              추가
            </Button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function ProjectTeamPage() {
  const { project } = useProjectContext();
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const members = useQuery({
    queryKey: ["members", project.id],
    queryFn: () => listProjectMembers(project.id),
  });
  const tasks = useQuery({
    queryKey: ["tasks", project.id],
    queryFn: () => listTasks(project.id),
  });
  const [addOpen, setAddOpen] = useState(false);
  const remove = useMutation({
    mutationFn: (member: ProjectMember) =>
      removeProjectMember(project.id, member.user_id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["members", project.id] }),
        queryClient.invalidateQueries({ queryKey: ["tasks", project.id] }),
      ]);
      showToast("팀원이 제거되었습니다.", { tone: "success" });
    },
    onError: () => showToast("팀원을 제거하지 못했습니다.", { tone: "error" }),
  });
  const rewrap = useMutation({
    mutationFn: (member: ProjectMember) =>
      rewrapProjectMemberKey(project.id, {
        id: member.user_id,
        encryption_public_key: member.profile?.encryption_public_key ?? null,
      }),
    onSuccess: () => showToast("프로젝트 접근 권한을 복구했습니다.", { tone: "success" }),
    onError: () => showToast("프로젝트 접근 권한을 복구하지 못했습니다.", { tone: "error" }),
  });
  const myRole = members.data?.find(
    (member) => member.user_id === user?.id,
  )?.role;
  const canManage = myRole === "owner" || myRole === "admin";
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="팀"
        title="팀 관리"
        description="프로젝트 팀원과 역할을 관리합니다."
        action={
          canManage && (
            <Button onClick={() => setAddOpen(true)}>
              <Plus size={16} /> 팀원 추가
            </Button>
          )
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {members.data?.map((member) => {
          const assigned =
            tasks.data?.filter((task) =>
              task.task_assignees?.some(
                (item) => item.user_id === member.user_id,
              ),
            ) ?? [];
          return (
            <div key={member.user_id} className="panel project-card p-5">
              <div className="flex items-start gap-3">
                <Avatar
                  name={member.profile?.name ?? "팀원"}
                  url={member.profile?.avatar_url}
                  size="lg"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-extrabold text-ink">
                    {member.profile?.name}
                  </div>
                  <div className="text-xs text-muted">
                    {member.profile?.student_id}
                  </div>
                </div>
                <Badge tone={member.role === "owner" ? "purple" : "neutral"}>
                  {projectRoleLabels[member.role]}
                </Badge>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                <div className="subtle-panel p-2">
                  <div className="text-lg font-extrabold text-ink">
                    {
                      assigned.filter((task) => task.status === "in_progress")
                        .length
                    }
                  </div>
                  <div className="text-[10px] text-muted">진행 중</div>
                </div>
                <div className="subtle-panel p-2">
                  <div className="text-lg font-extrabold text-ink">
                    {assigned.filter((task) => task.status === "todo").length}
                  </div>
                  <div className="text-[10px] text-muted">할 일</div>
                </div>
                <div className="subtle-panel p-2">
                  <div className="text-lg font-extrabold text-ink">
                    {assigned.filter((task) => task.status === "done").length}
                  </div>
                  <div className="text-[10px] text-muted">완료</div>
                </div>
              </div>
              <div className="mt-4 border-t border-line pt-3">
                <div className="mb-2 text-[11px] text-muted">
                  {member.profile?.github_username ? (
                    <span className="text-emerald-600">
                      @{member.profile.github_username} ·{" "}
                      {githubSyncStatusLabels[member.github_sync_status]}
                    </span>
                  ) : (
                    "GitHub 계정 미연결"
                  )}
                </div>
                {canManage && member.user_id !== user?.id && (
                  <div className="flex flex-wrap gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={
                        !member.profile?.encryption_public_key ||
                        rewrap.isPending
                      }
                      title={
                        !member.profile?.encryption_public_key
                          ? "사용자가 최초 비밀번호 변경을 완료해야 합니다."
                          : "비밀번호 초기화 후 프로젝트 접근 권한을 다시 복구합니다."
                      }
                      onClick={() => rewrap.mutate(member)}
                    >
                      <RefreshCw size={14} /> 프로젝트 접근 복구
                    </Button>
                    {member.role !== "owner" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600"
                        onClick={() => {
                          if (
                            confirm(
                              `${member.profile?.name}님을 프로젝트에서 제거할까요?`,
                            )
                          )
                            remove.mutate(member);
                        }}
                      >
                        <UserMinus size={14} /> 제거
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {member.github_sync_status === "error" && (
                <Alert className="mt-3">
                  프로젝트 권한은 적용됐지만 GitHub 연동에 실패했습니다. {githubErrorMessage(member.github_error_code)}
                </Alert>
              )}
            </div>
          );
        })}
      </div>
      <AddMemberDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        projectId={project.id}
      />
    </div>
  );
}

function GitHubIntegrationSection() {
  const { project } = useProjectContext();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const repositoryStatus = useQuery({
    queryKey: ["github-repository-status", project.id],
    queryFn: () => getGitHubRepositoryStatus(project.id),
    staleTime: 15_000,
  });
  const refetchRepositoryStatus = repositoryStatus.refetch;
  useEffect(() => {
    if (
      repositoryStatus.data?.status !== "recoverable" ||
      !repositoryStatus.data.reconciled
    )
      return;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["project", project.id] }),
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
    ]).then(() => refetchRepositoryStatus());
  }, [
    project.id,
    queryClient,
    refetchRepositoryStatus,
    repositoryStatus.data?.reconciled,
    repositoryStatus.data?.status,
  ]);
  const retry = useMutation({
    mutationFn: () => retryGitHubRepositoryCreation(project.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project", project.id] }),
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({
          queryKey: ["github-repository-status", project.id],
        }),
      ]);
      showToast("GitHub 저장소 연결을 갱신했습니다.", { tone: "success" });
    },
    onError: () => showToast("GitHub 저장소 연결을 갱신하지 못했습니다.", { tone: "error" }),
  });
  const state =
    repositoryStatus.data?.status ??
    (project.github_repository_url ? "connected" : "missing");
  const status =
    state === "connected"
      ? "연결됨"
      : state === "recoverable"
        ? "연결 복구됨"
        : state === "conflict"
          ? "확인 필요"
          : "미연결";
  const refresh = async () => {
    const result = await repositoryStatus.refetch();
    if (result.data?.status === "missing") retry.mutate();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["project", project.id] }),
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
    ]);
  };
  const repositoryUrl =
    repositoryStatus.data?.repositoryUrl ?? project.github_repository_url;
  const actionLabel =
    state === "missing"
      ? "저장소 만들기"
      : state === "recoverable"
        ? "저장소 다시 연결"
        : state === "conflict"
          ? "저장소 확인 필요"
          : "실제 상태 확인";
  return (
    <section className="panel p-6">
      <div className="mb-5"><p className="text-xs font-black tracking-wide text-muted">연동</p><h2 className="mt-1 text-lg font-extrabold text-ink">GitHub 저장소</h2><p className="mt-1 text-sm text-muted">프로젝트의 소스 코드 저장소를 연결합니다.</p></div>
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink text-surface">
              <Github />
            </div>
            <div>
              <h2 className="font-extrabold text-ink">
                {project.github_owner
                  ? `${project.github_owner}/${project.github_repository_name}`
                  : project.github_repository_name}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {project.visibility === "private"
                  ? "비공개 저장소"
                  : "공개 저장소"}
              </p>
              <div className="mt-2 flex gap-2">
                <Badge tone={project.status === "creating" ? "amber" : "green"}>
                  프로젝트 {project.status === "creating" ? "준비 중" : "활성"}
                </Badge>
                <Badge
                  tone={
                    state === "connected" || state === "recoverable"
                      ? "green"
                      : state === "conflict"
                        ? "red"
                        : "amber"
                  }
                >
                  GitHub {status}
                </Badge>
              </div>
            </div>
          </div>
        </div>
        {state === "conflict" && (
          <Alert className="mt-5">
            같은 이름의 저장소가 다른 프로젝트에 연결되어 있어 자동으로 연결하지 않았습니다.
          </Alert>
        )}
        {project.github_error_code && (
          <Alert className="mt-5">{githubErrorMessage(project.github_error_code)}</Alert>
        )}
        {repositoryStatus.error && (
          <Alert className="mt-5">
            {repositoryStatus.error.message}
          </Alert>
        )}
        <div className="mt-6 flex flex-wrap gap-2">
          {repositoryUrl && (
            <a href={repositoryUrl} target="_blank" rel="noopener noreferrer">
              <Button>
                <ExternalLink size={16} /> GitHub에서 열기
              </Button>
            </a>
          )}
          <Button
            variant="secondary"
            disabled={retry.isPending || repositoryStatus.isFetching}
            onClick={() => void refresh()}
          >
            <RefreshCw
              className={
                retry.isPending || repositoryStatus.isFetching
                  ? "animate-spin"
                  : ""
              }
              size={16}
            />{" "}
            {actionLabel}
          </Button>
        </div>
        <label className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-line p-3"><div><div className="text-sm font-semibold text-ink">팀원 권한 자동 연동</div><div className="text-xs text-muted">팀원을 추가하거나 제거할 때 GitHub 접근 권한도 함께 반영합니다.</div></div><input type="checkbox" aria-label="GitHub 팀원 권한 자동 연동" checked={project.github_auto_sync} onChange={(event) => void updateProject(project.id, { github_auto_sync: event.target.checked })} /></label>
        {repositoryStatus.data?.commits?.length ? <div className="mt-6 border-t border-line pt-5"><h3 className="text-sm font-extrabold text-ink">최근 커밋</h3><div className="mt-3 space-y-2">{repositoryStatus.data.commits.slice(0, 10).map((commit) => <div key={commit.sha} className="rounded-xl bg-raised p-3"><p className="truncate text-sm font-semibold text-ink">{commit.message.split("\n")[0]}</p><p className="mt-1 text-[10px] text-muted">{commit.author ?? "GitHub 사용자"} · {commit.authoredAt ? new Date(commit.authoredAt).toLocaleString("ko-KR") : "시간 정보 없음"} · {commit.sha}</p></div>)}</div></div> : null}
    </section>
  );
}

export function ProjectSettingsPage() {
  const { project } = useProjectContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const members = useQuery({
    queryKey: ["members", project.id],
    queryFn: () => listProjectMembers(project.id),
  });
  const user = useAuthStore((state) => state.user);
  const forgetProjectKey = useProjectKeyStore((state) => state.forget);
  const permissions = usePermissions();
  const canDeleteProject = permissions.has(ADMIN_PERMISSIONS.PROJECTS_DELETE);
  const { showToast } = useToast();
  const role = members.data?.find(
    (member) => member.user_id === user?.id,
  )?.role;
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [confirmation, setConfirmation] = useState("");
  const [dangerOpen, setDangerOpen] = useState(false);
  const save = useMutation({
    mutationFn: () => updateProject(project.id, { name, description }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["project", project.id],
      });
      showToast("프로젝트 설정이 저장되었습니다.", { tone: "success" });
    },
    onError: () => showToast("프로젝트 설정을 저장하지 못했습니다.", { tone: "error" }),
  });
  const archive = useMutation({
    mutationFn: () => updateProject(project.id, { status: "archived" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      showToast("프로젝트가 보관되었습니다.", { tone: "success" });
      navigate("/projects");
    },
    onError: () => showToast("프로젝트를 보관하지 못했습니다.", { tone: "error" }),
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteProject(project.id, confirmation),
    onSuccess: async () => {
      setDangerOpen(false);
      forgetProjectKey(project.id);
      queryClient.removeQueries({ queryKey: ["project", project.id] });
      queryClient.removeQueries({ queryKey: ["tasks", project.id] });
      queryClient.removeQueries({ queryKey: ["files", project.id] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      showToast("프로젝트가 삭제되었습니다.", { tone: "success" });
      navigate("/projects", { replace: true });
    },
    onError: (error) => showToast(
      error instanceof Error ? error.message : "프로젝트를 삭제하지 못했습니다.",
      { tone: "error" },
    ),
  });
  if (role !== "owner" && role !== "admin")
    return (
      <div className="page-wrap">
        <EmptyState
          icon={<ShieldCheck />}
          title="읽기 전용"
          description="프로젝트 소유자와 관리자만 설정을 변경할 수 있습니다."
        />
      </div>
    );
  return (
    <div className="page-wrap">
      <PageHeader eyebrow="설정" title="프로젝트 설정" />
      <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
        <form
          className="panel p-5"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <h2 className="font-extrabold text-ink">기본 정보</h2>
          <div className="mt-5">
            <label className="label" htmlFor="settings-name">
              프로젝트 이름
            </label>
            <Input
              id="settings-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="mt-4">
            <label className="label" htmlFor="settings-description">
              설명
            </label>
            <textarea
              id="settings-description"
              className="field min-h-24"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <Button type="submit" className="mt-5" disabled={save.isPending}>
            변경 저장
          </Button>
        </form>
        <section className="panel border-red-500/20 p-5">
          <h2 className="font-extrabold text-red-600">주의가 필요한 작업</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            프로젝트 보관은 목록에서 숨깁니다. 영구 삭제는 GitHub 저장소,
            파일과 프로젝트 데이터를 순서대로 정리합니다.
          </p>
          <Button
            variant="secondary"
            className="mt-5 w-full"
            onClick={() => archive.mutate()}
          >
            <Archive size={16} /> 프로젝트 보관
          </Button>
          {role === "owner" && canDeleteProject && (
            <Button
              variant="danger"
              className="mt-2 w-full"
              onClick={() => setDangerOpen(true)}
            >
              <Trash2 size={16} /> 프로젝트 영구 삭제
            </Button>
          )}
        </section>
      </div>
      {role === "owner" && <div className="mt-5"><GitHubIntegrationSection /></div>}
      <Modal
        open={dangerOpen && canDeleteProject}
        onClose={() => setDangerOpen(false)}
        title="프로젝트 영구 삭제"
        description="복구하기 어렵습니다. 계속하려면 프로젝트 이름을 정확히 입력하세요."
      >
        <Alert>
          GitHub 저장소, 암호화 파일과 프로젝트 업무 데이터가 함께
          삭제됩니다.
        </Alert>
        <label className="label mt-4" htmlFor="danger-confirm">
          {project.name}
        </label>
        <Input
          id="danger-confirm"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
        <Button
          variant="danger"
          className="mt-4 w-full"
          disabled={confirmation !== project.name || deleteMutation.isPending}
          onClick={() => deleteMutation.mutate()}
        >
          영구 삭제
        </Button>
      </Modal>
    </div>
  );
}
