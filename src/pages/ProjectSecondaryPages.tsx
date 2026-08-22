import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, parseISO, startOfMonth, startOfWeek } from "date-fns";
import { ko } from "date-fns/locale";
import { Archive, Download, ExternalLink, File, Github, Plus, RefreshCw, Search, ShieldCheck, Trash2, Upload, UserMinus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { listActivities } from "../services/activity";
import { deleteProjectFile, downloadProjectFile, listFiles, uploadProjectFile } from "../services/files";
import { addProjectMember, deleteProject, listProjectMembers, removeProjectMember, retryGitHubRepositoryCreation, rewrapProjectMemberKey, searchProfiles, updateProject } from "../services/projects";
import { listTasks, updateTask } from "../services/tasks";
import { useAuthStore } from "../stores/authStore";
import type { Profile, ProjectFile, ProjectMember, ProjectRole, Task } from "../types/domain";
import { formatBytes } from "../lib/utils";
import { useProjectContext } from "./ProjectPages";
import { Alert, Avatar, Badge, Button, EmptyState, Input, Modal, PageHeader, Spinner } from "../components/ui";
import { useProjectKeyStore } from "../stores/projectKeyStore";

const activityLabels: Record<string, string> = {
  project_created: "프로젝트를 생성했습니다.", member_added: "팀원을 추가했습니다.", member_removed: "팀원을 제거했습니다.",
  task_created: "작업을 생성했습니다.", task_status_changed: "작업 상태를 변경했습니다.", task_progress_changed: "진행률을 변경했습니다.",
  task_due_date_changed: "마감일을 변경했습니다.", assignee_added: "담당자를 추가했습니다.", assignee_removed: "담당자를 제거했습니다.",
  comment_created: "댓글을 작성했습니다.", file_uploaded: "파일을 업로드했습니다."
};

export function ProjectCalendarPage() {
  const { project } = useProjectContext();
  const queryClient = useQueryClient();
  const tasks = useQuery({ queryKey: ["tasks", project.id], queryFn: () => listTasks(project.id) });
  const [mode, setMode] = useState<"month" | "week" | "agenda">("month");
  const [cursor, setCursor] = useState(new Date());
  const monthDays = eachDayOfInterval({ start: startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 }), end: endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 }) });
  const weekDays = eachDayOfInterval({ start: startOfWeek(cursor, { weekStartsOn: 0 }), end: endOfWeek(cursor, { weekStartsOn: 0 }) });
  const dated = (tasks.data ?? []).filter((task) => task.start_date || task.due_date);
  const moveTask = async (taskId: string, date: Date) => {
    const task = tasks.data?.find((item) => item.id === taskId); if (!task) return;
    await updateTask(task, { due_date: format(date, "yyyy-MM-dd") });
    await queryClient.invalidateQueries({ queryKey: ["tasks", project.id] });
  };
  const taskPill = (task: Task) => <button key={task.id} draggable onDragStart={(event) => event.dataTransfer.setData("text/task-id", task.id)} className="mb-1 block w-full truncate rounded-md bg-brand/10 px-1.5 py-1 text-left text-[10px] font-semibold text-brand">{task.title}</button>;
  return <div className="page-wrap"><PageHeader eyebrow="Calendar" title="프로젝트 일정" description="Task의 start_date와 due_date를 기준으로 표시합니다." action={<div className="flex rounded-xl border border-line bg-surface p-1">{(["month", "week", "agenda"] as const).map((item) => <button key={item} onClick={() => setMode(item)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${mode === item ? "bg-brand text-white" : "text-muted"}`}>{item === "month" ? "Month" : item === "week" ? "Week" : "Agenda"}</button>)}</div>} />{tasks.isLoading ? <Spinner /> : <div className="panel overflow-hidden"><div className="flex items-center justify-between border-b border-line p-4"><Button variant="ghost" size="sm" onClick={() => setCursor(mode === "month" ? addDays(cursor, -30) : addDays(cursor, -7))}>이전</Button><h2 className="font-extrabold text-ink">{format(cursor, "yyyy년 M월", { locale: ko })}</h2><Button variant="ghost" size="sm" onClick={() => setCursor(mode === "month" ? addDays(cursor, 30) : addDays(cursor, 7))}>다음</Button></div>{mode === "month" && <div className="grid grid-cols-7">{["일", "월", "화", "수", "목", "금", "토"].map((day) => <div key={day} className="border-b border-r border-line bg-raised p-2 text-center text-[10px] font-bold text-muted">{day}</div>)}{monthDays.map((day) => <div key={day.toISOString()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => void moveTask(event.dataTransfer.getData("text/task-id"), day)} className={`min-h-28 border-b border-r border-line p-1.5 ${isSameMonth(day, cursor) ? "bg-surface" : "bg-raised/50 text-muted"}`}><div className={`mb-1 text-[11px] ${isSameDay(day, new Date()) ? "flex h-5 w-5 items-center justify-center rounded-full bg-brand font-bold text-white" : "text-muted"}`}>{format(day, "d")}</div>{dated.filter((task) => isSameDay(parseISO(task.due_date ?? task.start_date!), day)).slice(0, 3).map(taskPill)}</div>)}</div>}{mode === "week" && <div className="grid grid-cols-7">{weekDays.map((day) => <div key={day.toISOString()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => void moveTask(event.dataTransfer.getData("text/task-id"), day)} className="min-h-[420px] border-r border-line p-2"><div className="mb-4 text-center"><div className="text-[10px] font-bold text-muted">{format(day, "EEE", { locale: ko })}</div><div className="mt-1 text-lg font-extrabold text-ink">{format(day, "d")}</div></div>{dated.filter((task) => isSameDay(parseISO(task.due_date ?? task.start_date!), day)).map(taskPill)}</div>)}</div>}{mode === "agenda" && <div className="divide-y divide-line">{dated.sort((a, b) => (a.due_date ?? a.start_date ?? "").localeCompare(b.due_date ?? b.start_date ?? "")).map((task) => <div key={task.id} className="flex items-center gap-4 p-4"><div className="w-24 text-xs font-bold text-brand">{task.due_date ?? task.start_date}</div><div className="flex-1 text-sm font-semibold text-ink">{task.title}</div><Badge>{task.status}</Badge></div>)}</div>}</div>}</div>;
}

export function ProjectFilesPage() {
  const { project } = useProjectContext();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const files = useQuery({ queryKey: ["files", project.id], queryFn: () => listFiles(project.id) });
  const [progress, setProgress] = useState<{ phase: string; percent: number; name: string } | null>(null);
  const [preview, setPreview] = useState<{ file: ProjectFile; url: string; text?: string | undefined } | null>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  const upload = async (file: File) => { setProgress({ phase: "encrypting", percent: 0, name: file.name }); try { await uploadProjectFile(project.id, file, undefined, (phase, percent) => setProgress({ phase, percent, name: file.name })); await queryClient.invalidateQueries({ queryKey: ["files", project.id] }); } finally { setProgress(null); } };
  const download = async (item: ProjectFile, asPreview = false) => { const blob = await downloadProjectFile(item); const url = URL.createObjectURL(blob); if (asPreview && (/^(image\/|text\/|application\/pdf|application\/json)/u.test(item.mime_type))) { const text = /^(text\/|application\/json)/u.test(item.mime_type) ? await blob.text() : undefined; setPreview({ file: item, url, text }); } else { const anchor = document.createElement("a"); anchor.href = url; anchor.download = item.filename ?? "download"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } };
  return <div className="page-wrap"><PageHeader eyebrow="Encrypted storage" title="파일" description="원본 파일과 파일명은 브라우저에서 프로젝트 key로 암호화한 후 private Storage에 저장합니다." action={<label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white"><Upload size={16} /> 파일 업로드<input type="file" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ""; }} /></label>} />{progress && <div className="panel mb-4 p-4"><div className="flex justify-between text-xs"><span className="font-semibold text-ink">{progress.name} · {progress.phase === "encrypting" ? "암호화 중" : "업로드 중"}</span><span className="text-muted">{progress.percent}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-line"><div className="h-full bg-brand" style={{ width: `${progress.percent}%` }} /></div></div>}{files.isLoading ? <Spinner /> : files.data?.length ? <div className="panel divide-y divide-line overflow-hidden">{files.data.map((file) => <div key={file.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand"><File size={19} /></div><div className="min-w-0 flex-1"><button className="max-w-full truncate text-left text-sm font-bold text-ink hover:text-brand" onClick={() => void download(file, true)}>{file.filename}</button><div className="mt-1 text-[11px] text-muted">{formatBytes(file.original_size)} · {file.uploader?.name ?? "사용자"} · {new Date(file.created_at).toLocaleString("ko-KR")}</div>{file.task && <Link to={`/tasks/${file.task.id}`} className="mt-1 inline-block text-[11px] font-semibold text-brand hover:underline">연결된 작업: {file.task.title}</Link>}</div><Button variant="secondary" size="sm" onClick={() => void download(file)}><Download size={14} /> 다운로드</Button>{file.uploaded_by === user?.id && <Button variant="ghost" size="sm" className="text-red-600" onClick={async () => { if (confirm("파일을 삭제할까요?")) { await deleteProjectFile(file); await queryClient.invalidateQueries({ queryKey: ["files", project.id] }); } }}><Trash2 size={14} /> 삭제</Button>}</div>)}</div> : <EmptyState icon={<Upload />} title="공유 파일이 없습니다" description="50 MiB 이하 파일을 업로드하면 원본이 브라우저 밖으로 나가기 전에 AES-256-GCM으로 암호화됩니다." />}<Modal open={Boolean(preview)} onClose={() => { if (preview) URL.revokeObjectURL(preview.url); setPreview(null); }} title={preview?.file.filename ?? "미리보기"} className="max-w-4xl">{preview?.text !== undefined ? <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-xl bg-canvas p-4 text-xs text-ink">{preview.text}</pre> : preview?.file.mime_type.startsWith("image/") ? <img src={preview.url} alt="복호화 파일 미리보기" className="mx-auto max-h-[70vh] rounded-xl object-contain" /> : preview && <iframe src={preview.url} title="복호화 PDF 미리보기" className="h-[70vh] w-full rounded-xl border border-line" sandbox="allow-same-origin" />}</Modal></div>;
}

export function ProjectActivityPage() {
  const { project } = useProjectContext();
  const activities = useQuery({ queryKey: ["activities", project.id], queryFn: () => listActivities(project.id) });
  return <div className="page-wrap"><PageHeader eyebrow="Audit trail" title="프로젝트 활동" description="보안 및 협업 변경을 시간순으로 기록합니다." />{activities.isLoading ? <Spinner /> : <div className="panel divide-y divide-line">{activities.data?.map((activity) => <div key={activity.id} className="flex gap-3 p-4"><Avatar name={activity.actor?.name ?? "시스템"} url={activity.actor?.avatar_url} size="sm" /><div><p className="text-sm text-ink"><strong>{activity.actor?.name ?? "시스템"}</strong>님이 {activityLabels[activity.action] ?? activity.action}</p><p className="mt-1 text-[11px] text-muted">{new Date(activity.created_at).toLocaleString("ko-KR")}</p></div></div>)}</div>}</div>;
}

function AddMemberDialog({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<Exclude<ProjectRole, "owner">>("member");
  const search = useQuery({ queryKey: ["profile-search", query], queryFn: () => searchProfiles(query), enabled: query.trim().length >= 2 });
  const mutation = useMutation({ mutationFn: (profile: Profile) => addProjectMember(projectId, profile, role), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["members", projectId] }); onClose(); } });
  return <Modal open={open} onClose={onClose} title="팀원 추가" description="학번 또는 이름으로 검색합니다. 전체 사용자 목록은 내려받지 않습니다."><div className="relative"><Search className="absolute left-3 top-3 text-muted" size={16} /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="20260004 또는 최지훈" autoFocus /></div><div className="mt-3"><label className="label" htmlFor="member-role">역할</label><select id="member-role" className="field" value={role} onChange={(event) => setRole(event.target.value as Exclude<ProjectRole, "owner">)}><option value="member">Member</option><option value="admin">Admin</option><option value="viewer">Viewer</option></select></div>{mutation.error && <Alert className="mt-3">{mutation.error.message}</Alert>}<div className="mt-4 max-h-72 space-y-2 overflow-y-auto">{search.data?.map((profile) => <div key={profile.id} className="flex items-center gap-3 rounded-xl border border-line p-3"><Avatar name={profile.name} url={profile.avatar_url} size="sm" /><div className="min-w-0 flex-1"><div className="text-sm font-semibold text-ink">{profile.name}</div><div className="text-[11px] text-muted">{profile.student_id} · {profile.github_username ? `@${profile.github_username}` : "GitHub 계정 미연결"}</div></div><Button size="sm" disabled={mutation.isPending || !profile.encryption_public_key} title={!profile.encryption_public_key ? "대상 사용자가 먼저 로그인해 keyring을 만들어야 합니다." : undefined} onClick={() => mutation.mutate(profile)}>추가</Button></div>)}</div></Modal>;
}

export function ProjectTeamPage() {
  const { project } = useProjectContext();
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const members = useQuery({ queryKey: ["members", project.id], queryFn: () => listProjectMembers(project.id) });
  const tasks = useQuery({ queryKey: ["tasks", project.id], queryFn: () => listTasks(project.id) });
  const [addOpen, setAddOpen] = useState(false);
  const remove = useMutation({ mutationFn: (member: ProjectMember) => removeProjectMember(project.id, member.user_id), onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["members", project.id] }), queryClient.invalidateQueries({ queryKey: ["tasks", project.id] })]); } });
  const rewrap = useMutation({ mutationFn: (member: ProjectMember) => rewrapProjectMemberKey(project.id, { id: member.user_id, encryption_public_key: member.profile?.encryption_public_key ?? null }) });
  const myRole = members.data?.find((member) => member.user_id === user?.id)?.role;
  const canManage = myRole === "owner" || myRole === "admin";
  return <div className="page-wrap">
    <PageHeader eyebrow="Team" title="팀 관리" description="멤버 추가 즉시 RLS 접근과 member-specific project key가 함께 생성됩니다." action={canManage && <Button onClick={() => setAddOpen(true)}><Plus size={16} /> 팀원 추가</Button>} />
    {(remove.error || rewrap.error) && <Alert className="mb-4">{remove.error?.message ?? rewrap.error?.message}</Alert>}
    {rewrap.isSuccess && <Alert tone="success" className="mb-4">프로젝트 암호화 키를 다시 공유했습니다.</Alert>}
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{members.data?.map((member) => {
      const assigned = tasks.data?.filter((task) => task.task_assignees?.some((item) => item.user_id === member.user_id)) ?? [];
      return <div key={member.user_id} className="panel p-5"><div className="flex items-start gap-3"><Avatar name={member.profile?.name ?? "팀원"} url={member.profile?.avatar_url} size="lg" /><div className="min-w-0 flex-1"><div className="truncate font-extrabold text-ink">{member.profile?.name}</div><div className="text-xs text-muted">{member.profile?.student_id}</div></div><Badge tone={member.role === "owner" ? "purple" : "neutral"}>{member.role}</Badge></div><div className="mt-5 grid grid-cols-3 gap-2 text-center"><div className="subtle-panel p-2"><div className="text-lg font-extrabold text-ink">{assigned.filter((task) => task.status === "in_progress").length}</div><div className="text-[10px] text-muted">진행 중</div></div><div className="subtle-panel p-2"><div className="text-lg font-extrabold text-ink">{assigned.filter((task) => task.status === "todo").length}</div><div className="text-[10px] text-muted">TODO</div></div><div className="subtle-panel p-2"><div className="text-lg font-extrabold text-ink">{assigned.filter((task) => task.status === "done").length}</div><div className="text-[10px] text-muted">완료</div></div></div><div className="mt-4 border-t border-line pt-3"><div className="mb-2 text-[11px] text-muted">{member.profile?.github_username ? <span className="text-emerald-600">@{member.profile.github_username} · {member.github_sync_status}</span> : "GitHub 계정 미연결"}</div>{canManage && member.user_id !== user?.id && <div className="flex flex-wrap gap-1"><Button variant="ghost" size="sm" disabled={!member.profile?.encryption_public_key || rewrap.isPending} title={!member.profile?.encryption_public_key ? "사용자가 최초 비밀번호 변경을 완료해야 합니다." : "비밀번호 초기화 후 새 public key로 DEK를 다시 wrapping합니다."} onClick={() => rewrap.mutate(member)}><RefreshCw size={14} /> 암호화 키 재공유</Button>{member.role !== "owner" && <Button variant="ghost" size="sm" className="text-red-600" onClick={() => { if (confirm(`${member.profile?.name}님을 프로젝트에서 제거할까요?`)) remove.mutate(member); }}><UserMinus size={14} /> 제거</Button>}</div>}</div>{member.github_sync_status === "error" && <Alert className="mt-3">사이트 권한은 적용됐지만 GitHub 동기화에 실패했습니다: {member.github_error_code}</Alert>}</div>;
    })}</div>
    <AddMemberDialog open={addOpen} onClose={() => setAddOpen(false)} projectId={project.id} />
  </div>;
}

export function ProjectGitHubPage() {
  const { project } = useProjectContext();
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: () => retryGitHubRepositoryCreation(project.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project", project.id] }),
        queryClient.invalidateQueries({ queryKey: ["projects"] })
      ]);
    }
  });
  if (project.created_by !== user?.id) return <Navigate to={`/projects/${project.id}`} replace />;
  const status = project.github_repository_url ? project.github_sync_status === "error" ? "동기화 오류" : "연결됨" : project.status === "creating" ? "생성 중" : "Repository 없음";
  const refresh = async () => {
    if (project.github_repository_url) {
      await queryClient.invalidateQueries({ queryKey: ["project", project.id] });
    } else {
      retry.mutate();
    }
  };
  return <div className="page-wrap"><PageHeader eyebrow="Integration" title="GitHub Repository" description="업무 데이터가 아니라 실제 프로젝트 코드와 문서를 위한 저장소입니다." /><div className="panel max-w-3xl p-6"><div className="flex items-start justify-between gap-4"><div className="flex gap-4"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink text-surface"><Github /></div><div><h2 className="font-extrabold text-ink">{project.github_owner ? `${project.github_owner}/${project.github_repository_name}` : project.github_repository_name}</h2><p className="mt-1 text-sm text-muted">{project.visibility === "private" ? "Private Repository" : "Public Repository"}</p></div></div><Badge tone={status === "연결됨" ? "green" : status === "동기화 오류" ? "red" : "amber"}>{status}</Badge></div>{project.github_error_code && <Alert className="mt-5">{project.github_error_code}</Alert>}{retry.error && <Alert className="mt-5">{retry.error.message}</Alert>}<div className="mt-6 flex flex-wrap gap-2">{project.github_repository_url && <a href={project.github_repository_url} target="_blank" rel="noopener noreferrer"><Button><ExternalLink size={16} /> GitHub에서 열기</Button></a>}<Button variant="secondary" disabled={retry.isPending} onClick={() => void refresh()}><RefreshCw className={retry.isPending ? "animate-spin" : ""} size={16} /> {project.github_repository_url ? "상태 새로고침" : "Repository 생성 재시도"}</Button></div></div></div>;
}

export function ProjectSettingsPage() {
  const { project } = useProjectContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const members = useQuery({ queryKey: ["members", project.id], queryFn: () => listProjectMembers(project.id) });
  const user = useAuthStore((state) => state.user);
  const forgetProjectKey = useProjectKeyStore((state) => state.forget);
  const role = members.data?.find((member) => member.user_id === user?.id)?.role;
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [confirmation, setConfirmation] = useState("");
  const [dangerOpen, setDangerOpen] = useState(false);
  const save = useMutation({ mutationFn: () => updateProject(project.id, { name, description }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["project", project.id] }); } });
  const archive = useMutation({ mutationFn: () => updateProject(project.id, { status: "archived" }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["projects"] }); navigate("/projects"); } });
  const deleteMutation = useMutation({ mutationFn: () => deleteProject(project.id, confirmation), onSuccess: async () => { setDangerOpen(false); forgetProjectKey(project.id); queryClient.removeQueries({ queryKey: ["project", project.id] }); queryClient.removeQueries({ queryKey: ["tasks", project.id] }); queryClient.removeQueries({ queryKey: ["files", project.id] }); await queryClient.invalidateQueries({ queryKey: ["projects"] }); navigate("/projects", { replace: true }); } });
  if (role !== "owner" && role !== "admin") return <div className="page-wrap"><EmptyState icon={<ShieldCheck />} title="읽기 전용" description="Owner와 Admin만 프로젝트 설정을 변경할 수 있습니다." /></div>;
  return <div className="page-wrap"><PageHeader eyebrow="Settings" title="프로젝트 설정" /><div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]"><form className="panel p-5" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}><h2 className="font-extrabold text-ink">기본 정보</h2><div className="mt-5"><label className="label" htmlFor="settings-name">프로젝트 이름</label><Input id="settings-name" value={name} onChange={(event) => setName(event.target.value)} /></div><div className="mt-4"><label className="label" htmlFor="settings-description">설명</label><textarea id="settings-description" className="field min-h-24" value={description} onChange={(event) => setDescription(event.target.value)} /></div><label className="mt-4 flex items-center justify-between rounded-xl border border-line p-3"><div><div className="text-sm font-semibold text-ink">GitHub 접근 권한 자동 동기화</div><div className="text-xs text-muted">팀원 추가/제거 시 collaborator 반영</div></div><input type="checkbox" checked={project.github_auto_sync} onChange={(event) => void updateProject(project.id, { github_auto_sync: event.target.checked })} /></label><Button type="submit" className="mt-5" disabled={save.isPending}>변경 저장</Button></form><section className="panel border-red-500/20 p-5"><h2 className="font-extrabold text-red-600">Danger zone</h2><p className="mt-2 text-sm leading-6 text-muted">프로젝트 보관은 목록에서 숨깁니다. 영구 삭제는 GitHub Repository, private 파일과 프로젝트 데이터를 순서대로 정리합니다.</p><Button variant="secondary" className="mt-5 w-full" onClick={() => archive.mutate()}><Archive size={16} /> 프로젝트 보관</Button>{role === "owner" && <Button variant="danger" className="mt-2 w-full" onClick={() => setDangerOpen(true)}><Trash2 size={16} /> 프로젝트 영구 삭제</Button>}</section></div><Modal open={dangerOpen} onClose={() => setDangerOpen(false)} title="프로젝트 영구 삭제" description="복구하기 어렵습니다. 계속하려면 프로젝트 이름을 정확히 입력하세요."><Alert>GitHub Repository, 암호화 파일과 프로젝트 업무 데이터가 함께 삭제됩니다.</Alert>{deleteMutation.error && <Alert className="mt-3">{deleteMutation.error.message}</Alert>}<label className="label mt-4" htmlFor="danger-confirm">{project.name}</label><Input id="danger-confirm" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /><Button variant="danger" className="mt-4 w-full" disabled={confirmation !== project.name || deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>영구 삭제</Button></Modal></div>;
}
