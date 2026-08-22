import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  Circle,
  Download,
  File,
  MessageSquare,
  MoreVertical,
  Plus,
  Save,
  Trash2,
  Upload,
  UserPlus,
  X,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { MarkdownText } from "../components/MarkdownText";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  EmptyState,
  Input,
  Modal,
  Spinner,
} from "../components/ui";
import { listProjectMembers } from "../services/projects";
import {
  addAssignee,
  addChecklistItem,
  createComment,
  deleteComment,
  deleteTask,
  getTask,
  listComments,
  removeAssignee,
  updateChecklistItem,
  updateComment,
  updateTask,
} from "../services/tasks";
import { useAuthStore } from "../stores/authStore";
import type {
  ProjectFile,
  Task,
  TaskPriority,
  TaskStatus,
} from "../types/domain";
import {
  deleteProjectFile,
  downloadProjectFile,
  listTaskFiles,
  uploadProjectFile,
} from "../services/files";
import { canPreviewInBrowser, validateProjectFile } from "../lib/filePolicy";
import { formatBytes } from "../lib/utils";

function TaskAttachments({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const files = useQuery({
    queryKey: ["task-files", task.id],
    queryFn: () => listTaskFiles(task.project_id, task.id),
  });
  const members = useQuery({
    queryKey: ["members", task.project_id],
    queryFn: () => listProjectMembers(task.project_id),
  });
  const canManageFiles = ["owner", "admin"].includes(
    members.data?.find((member) => member.user_id === user?.id)?.role ?? "",
  );
  const [preview, setPreview] = useState<{
    file: ProjectFile;
    url: string;
    text?: string;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["task-files", task.id] }),
      queryClient.invalidateQueries({ queryKey: ["files", task.project_id] }),
    ]);
  };
  const open = async (file: ProjectFile, previewRequested: boolean) => {
    try {
      const blob = await downloadProjectFile(file);
      const url = URL.createObjectURL(blob);
      if (previewRequested && canPreviewInBrowser(file.mime_type)) {
        const text = /^(text\/|application\/json)/u.test(file.mime_type)
          ? await blob.text()
          : undefined;
        setPreview({ file, url, ...(text !== undefined ? { text } : {}) });
      } else {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = file.filename ?? "download";
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1_000);
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "파일을 열 수 없습니다.",
      );
    }
  };
  const upload = async (file: File) => {
    try {
      validateProjectFile(file);
      await uploadProjectFile(task.project_id, file, task.id);
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "파일을 업로드할 수 없습니다.",
      );
    }
  };
  return (
    <section className="panel p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <File size={18} className="text-brand" />
          <h2 className="font-extrabold text-ink">첨부 파일</h2>
          <Badge>{files.data?.length ?? 0}</Badge>
        </div>
        <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-semibold text-ink hover:bg-raised">
          <Upload size={14} /> 파일 추가
          <input
            type="file"
            multiple
            className="sr-only"
            onChange={(event) => {
              for (const file of Array.from(event.target.files ?? []))
                void upload(file);
              event.currentTarget.value = "";
            }}
          />
        </label>
      </div>
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
      <div className="mt-4 space-y-2">
        {files.data?.map((file) => (
          <div
            key={file.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <File size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <button
                className="max-w-full truncate text-left text-sm font-bold text-ink hover:text-brand"
                onClick={() => void open(file, true)}
              >
                {file.filename}
              </button>
              <p className="mt-1 text-[11px] text-muted">
                {file.mime_type} · {formatBytes(file.original_size)} ·{" "}
                {file.uploader?.name ?? "사용자"} ·{" "}
                {new Date(file.created_at).toLocaleString("ko-KR")}
              </p>
            </div>
            {canPreviewInBrowser(file.mime_type) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void open(file, true)}
              >
                미리보기
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void open(file, false)}
            >
              <Download size={13} /> 다운로드
            </Button>
            {(file.uploaded_by === user?.id || canManageFiles) && (
              <Button
                size="sm"
                variant="ghost"
                className="text-red-600"
                aria-label={`${file.filename} 삭제`}
                onClick={async () => {
                  if (confirm("첨부 파일을 삭제할까요?")) {
                    await deleteProjectFile(file);
                    await refresh();
                  }
                }}
              >
                <Trash2 size={13} />
              </Button>
            )}
          </div>
        ))}
        {!files.isLoading && !files.data?.length && (
          <p className="py-5 text-center text-sm text-muted">
            첨부된 파일이 없습니다.
          </p>
        )}
      </div>
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
            alt="첨부 파일 미리보기"
            className="mx-auto max-h-[70vh] rounded-xl object-contain"
          />
        ) : (
          preview && (
            <iframe
              src={preview.url}
              title="첨부 파일 PDF 미리보기"
              className="h-[70vh] w-full rounded-xl border border-line"
              sandbox="allow-same-origin"
            />
          )
        )}
      </Modal>
    </section>
  );
}

export function TaskPage() {
  const { taskId } = useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const taskQuery = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => getTask(taskId!),
    enabled: Boolean(taskId),
  });
  const task = taskQuery.data;
  const members = useQuery({
    queryKey: ["members", task?.project_id],
    queryFn: () => listProjectMembers(task!.project_id),
    enabled: Boolean(task),
  });
  const comments = useQuery({
    queryKey: ["comments", taskId],
    queryFn: () => listComments(task!),
    enabled: Boolean(task),
  });
  const [description, setDescription] = useState("");
  const [editingDescription, setEditingDescription] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [progressDraft, setProgressDraft] = useState(0);
  const [comment, setComment] = useState("");
  const [newChecklist, setNewChecklist] = useState("");
  const [editComment, setEditComment] = useState<{
    id: string;
    value: string;
  } | null>(null);
  useEffect(() => {
    if (task && !editingDescription) {
      setDescription(task.description ?? "");
      setProgressDraft(task.progress);
    }
  }, [editingDescription, task]);
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
      task &&
        queryClient.invalidateQueries({ queryKey: ["tasks", task.project_id] }),
    ]);
  };
  const mutation = useMutation({
    mutationFn: async (updates: Parameters<typeof updateTask>[1]) => {
      if (!task) return;
      await updateTask(task, updates);
    },
    onSuccess: refresh,
  });
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!task) throw new Error("작업을 찾을 수 없습니다.");
      return deleteTask(task.id);
    },
    onSuccess: async (deleted) => {
      setDeleteOpen(false);
      queryClient.removeQueries({ queryKey: ["task", task?.id] });
      queryClient.removeQueries({ queryKey: ["task-files", task?.id] });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["tasks", deleted.projectId],
        }),
        queryClient.invalidateQueries({ queryKey: ["accessible-tasks"] }),
        queryClient.invalidateQueries({
          queryKey: ["files", deleted.projectId],
        }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
      navigate(`/projects/${deleted.projectId}/board`, { replace: true });
    },
  });
  if (taskQuery.isLoading)
    return (
      <div className="page-wrap flex min-h-72 items-center justify-center">
        <Spinner />
      </div>
    );
  if (taskQuery.error || !task)
    return (
      <div className="page-wrap">
        <EmptyState
          icon={<Trash2 />}
          title="작업에 접근할 수 없습니다"
          description="프로젝트 멤버가 아니거나 삭제된 작업입니다."
        />
      </div>
    );
  const assignedIds = new Set(task.task_assignees?.map((item) => item.user_id));
  const checklist = task.task_checklist_items ?? [];
  const checklistProgress = checklist.length
    ? Math.round(
        (checklist.filter((item) => item.completed).length / checklist.length) *
          100,
      )
    : 0;
  const currentRole = members.data?.find(
    (member) => member.user_id === user?.id,
  )?.role;
  const canDelete =
    currentRole === "owner" ||
    currentRole === "admin" ||
    task.created_by === user?.id;
  const saveDescription = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate(
      { description },
      { onSuccess: () => setEditingDescription(false) },
    );
  };
  const toggleChecklist = async (itemId: string, completed: boolean) => {
    const item = checklist.find((entry) => entry.id === itemId);
    if (!item) return;
    await updateChecklistItem(item, completed);
    const nextCompleted = checklist.filter((entry) =>
      entry.id === itemId ? completed : entry.completed,
    ).length;
    await updateTask(task, {
      progress_mode: "checklist",
      progress: checklist.length
        ? Math.round((nextCompleted / checklist.length) * 100)
        : 0,
    });
    await refresh();
  };
  const addChecklist = async (event: FormEvent) => {
    event.preventDefault();
    if (!newChecklist.trim()) return;
    await addChecklistItem(task, newChecklist.trim(), checklist.length);
    setNewChecklist("");
    await refresh();
  };
  const postComment = async (event: FormEvent) => {
    event.preventDefault();
    if (!comment.trim()) return;
    await createComment(task, comment.trim());
    setComment("");
    await queryClient.invalidateQueries({ queryKey: ["comments", taskId] });
  };
  return (
    <div className="page-wrap max-w-6xl">
      <Link
        to={`/projects/${task.project_id}/board`}
        className="mb-5 inline-flex items-center gap-2 text-xs font-semibold text-muted hover:text-brand"
      >
        <ArrowLeft size={15} /> Board로 돌아가기
      </Link>
      <div className="grid gap-5 xl:grid-cols-[1.5fr_.7fr]">
        <div className="space-y-5">
          <section className="panel p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="mb-2 flex gap-2">
                  <Badge
                    tone={
                      task.status === "done"
                        ? "green"
                        : task.status === "in_progress"
                          ? "blue"
                          : task.status === "review"
                            ? "purple"
                            : "neutral"
                    }
                  >
                    {task.status}
                  </Badge>
                  <Badge
                    tone={
                      task.priority === "urgent"
                        ? "red"
                        : task.priority === "high"
                          ? "amber"
                          : "neutral"
                    }
                  >
                    {task.priority}
                  </Badge>
                </div>
                <h1 className="text-2xl font-extrabold tracking-tight text-ink">
                  {task.title}
                </h1>
              </div>
              {canDelete && (
                <details className="relative">
                  <summary aria-label="작업 메뉴" className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg text-muted hover:bg-raised hover:text-ink">
                    <MoreVertical size={18} />
                  </summary>
                  <div className="absolute right-0 z-20 mt-1 w-36 rounded-xl border border-line bg-surface p-1 shadow-lift">
                    <button className="w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-red-600 hover:bg-red-500/10" onClick={() => setDeleteOpen(true)}>
                      작업 삭제
                    </button>
                  </div>
                </details>
              )}
            </div>
            <div className="mt-6">
              <div className="flex items-center justify-between gap-3 border-b border-line pb-2">
                <h2 className="font-extrabold text-ink">설명</h2>
                {!editingDescription && <Button size="sm" variant="ghost" onClick={() => setEditingDescription(true)}>편집</Button>}
              </div>
              {editingDescription ? (
                <form onSubmit={saveDescription} className="mt-4">
                  <label className="label" htmlFor="task-description-edit">설명 · Markdown</label>
                  <textarea id="task-description-edit" className="field min-h-36" value={description} onChange={(event) => setDescription(event.target.value)} />
                  <div className="mt-3 flex justify-end gap-2">
                    <Button size="sm" variant="secondary" onClick={() => { setDescription(task.description ?? ""); setEditingDescription(false); }}>취소</Button>
                    <Button type="submit" size="sm" disabled={mutation.isPending}><Save size={14} /> 저장</Button>
                  </div>
                </form>
              ) : (
                <div className="mt-4 min-h-12">
                  {task.description ? <MarkdownText>{task.description}</MarkdownText> : <p className="text-sm text-muted">설명이 없습니다.</p>}
                </div>
              )}
            </div>
          </section>
          <section className="panel p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-extrabold text-ink">Checklist</h2>
              <span className="text-xs font-bold text-brand">
                {task.progress_mode === "checklist"
                  ? checklistProgress
                  : task.progress}
                %
              </span>
            </div>
            <div className="mt-4 space-y-2">
              {checklist.map((item) => (
                <button
                  key={item.id}
                  onClick={() => void toggleChecklist(item.id, !item.completed)}
                  className="flex w-full items-center gap-3 rounded-xl border border-line p-3 text-left hover:bg-raised"
                >
                  {item.completed ? (
                    <CheckCircle2 className="text-emerald-500" size={19} />
                  ) : (
                    <Circle className="text-muted" size={19} />
                  )}
                  <span
                    className={`text-sm ${item.completed ? "text-muted line-through" : "text-ink"}`}
                  >
                    {item.content}
                  </span>
                </button>
              ))}
            </div>
            <form onSubmit={addChecklist} className="mt-3 flex gap-2">
              <Input
                value={newChecklist}
                onChange={(event) => setNewChecklist(event.target.value)}
                placeholder="체크리스트 항목"
              />
              <Button type="submit" variant="secondary">
                <Plus size={15} />
              </Button>
            </form>
          </section>
          <TaskAttachments task={task} />
          <section className="panel p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <MessageSquare size={18} className="text-brand" />
              <h2 className="font-extrabold text-ink">댓글</h2>
              <Badge>{comments.data?.length ?? 0}</Badge>
            </div>
            <div className="mt-5 space-y-4">
              {comments.data?.map((item) => (
                <div key={item.id} className="flex gap-3">
                  <Avatar
                    name={item.author?.name ?? "사용자"}
                    url={item.author?.avatar_url}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1 rounded-xl border border-line bg-raised p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <span className="text-xs font-bold text-ink">
                          {item.author?.name}
                        </span>
                        <span className="ml-2 text-[10px] text-muted">
                          {new Date(item.created_at).toLocaleString("ko-KR")}
                        </span>
                      </div>
                      {item.author_id === user?.id && (
                        <div className="flex">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setEditComment({
                                id: item.id,
                                value: item.content ?? "",
                              })
                            }
                          >
                            수정
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600"
                            onClick={async () => {
                              await deleteComment(item.id);
                              await queryClient.invalidateQueries({
                                queryKey: ["comments", taskId],
                              });
                            }}
                          >
                            <Trash2 size={13} />
                          </Button>
                        </div>
                      )}
                    </div>
                    {editComment?.id === item.id ? (
                      <form
                        className="mt-2 flex gap-2"
                        onSubmit={async (event) => {
                          event.preventDefault();
                          await updateComment(task, item, editComment.value);
                          setEditComment(null);
                          await queryClient.invalidateQueries({
                            queryKey: ["comments", taskId],
                          });
                        }}
                      >
                        <Input
                          value={editComment.value}
                          onChange={(event) =>
                            setEditComment({
                              ...editComment,
                              value: event.target.value,
                            })
                          }
                        />
                        <Button type="submit" size="sm">
                          <Check size={14} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditComment(null)}
                        >
                          <X size={14} />
                        </Button>
                      </form>
                    ) : (
                      <div className="mt-2">
                        <MarkdownText>{item.content ?? ""}</MarkdownText>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <form onSubmit={postComment} className="mt-5">
              <textarea
                className="field min-h-24"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="댓글을 입력하세요. Markdown, code block, @학번 mention을 지원합니다."
              />
              <div className="mt-2 flex justify-end">
                <Button type="submit" disabled={!comment.trim()}>
                  댓글 작성
                </Button>
              </div>
            </form>
          </section>
        </div>
        <aside className="space-y-5">
          <section className="panel p-5">
            <h2 className="font-extrabold text-ink">작업 속성</h2>
            <label className="label mt-5" htmlFor="task-status">
              상태
            </label>
            <select
              id="task-status"
              className="field"
              value={task.status}
              onChange={(event) =>
                mutation.mutate({ status: event.target.value as TaskStatus })
              }
            >
              <option value="todo">TODO</option>
              <option value="in_progress">진행 중</option>
              <option value="review">검토</option>
              <option value="done">완료</option>
            </select>
            <label className="label mt-4" htmlFor="task-priority-detail">
              우선순위
            </label>
            <select
              id="task-priority-detail"
              className="field"
              value={task.priority}
              onChange={(event) =>
                mutation.mutate({
                  priority: event.target.value as TaskPriority,
                })
              }
            >
              <option value="low">낮음</option>
              <option value="medium">보통</option>
              <option value="high">높음</option>
              <option value="urgent">긴급</option>
            </select>
            <label className="label mt-4" htmlFor="task-progress">
              진행률 {progressDraft}%
            </label>
            <input
              id="task-progress"
              type="range"
              min="0"
              max="100"
              value={progressDraft}
              onChange={(event) => setProgressDraft(Number(event.target.value))}
              onPointerUp={() =>
                mutation.mutate({
                  progress_mode: "manual",
                  progress: progressDraft,
                })
              }
              onKeyUp={() =>
                mutation.mutate({
                  progress_mode: "manual",
                  progress: progressDraft,
                })
              }
              className="w-full accent-blue-600"
            />
            <label className="label mt-4" htmlFor="task-due-detail">
              마감일
            </label>
            <Input
              id="task-due-detail"
              type="date"
              value={task.due_date ?? ""}
              onChange={(event) =>
                mutation.mutate({ due_date: event.target.value || null })
              }
            />
          </section>
          <section className="panel p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-extrabold text-ink">담당자</h2>
              <UserPlus size={17} className="text-brand" />
            </div>
            <div className="mt-4 space-y-2">
              {task.task_assignees?.map((assignee) => (
                <div
                  key={assignee.user_id}
                  className="flex items-center gap-2 rounded-xl border border-line p-2"
                >
                  <Avatar
                    name={assignee.profile?.name ?? "팀원"}
                    url={assignee.profile?.avatar_url}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">
                    {assignee.profile?.name}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-red-600"
                    onClick={async () => {
                      await removeAssignee(task.id, assignee.user_id);
                      await refresh();
                    }}
                  >
                    <X size={13} />
                  </Button>
                </div>
              ))}
              {!task.task_assignees?.length && (
                <p className="text-xs text-muted">미배정</p>
              )}
            </div>
            <label className="label mt-4" htmlFor="add-assignee">
              + 담당자 추가
            </label>
            <select
              id="add-assignee"
              className="field"
              defaultValue=""
              onChange={async (event) => {
                if (!event.target.value) return;
                await addAssignee(task.id, event.target.value);
                event.target.value = "";
                await refresh();
              }}
            >
              <option value="">프로젝트 멤버 선택</option>
              {members.data
                ?.filter((member) => !assignedIds.has(member.user_id))
                .map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {member.profile?.name} ({member.profile?.student_id})
                  </option>
                ))}
            </select>
          </section>
          <section className="panel p-5">
            <div className="flex items-center gap-2 text-sm text-muted">
              <CalendarDays size={16} /> 생성{" "}
              {new Date(task.created_at).toLocaleDateString("ko-KR")}
            </div>
          </section>
        </aside>
      </div>
      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="작업 삭제"
        description="이 작업을 삭제하시겠습니까? 첨부 파일과 작업 관련 데이터도 함께 삭제됩니다."
      >
        {deleteMutation.error && <Alert className="mb-4">{deleteMutation.error.message}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteOpen(false)}>취소</Button>
          <Button variant="danger" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
            <Trash2 size={14} /> 작업 삭제
          </Button>
        </div>
      </Modal>
    </div>
  );
}
