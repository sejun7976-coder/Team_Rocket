import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Check, Send, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { isMutatingAIAction, type AIAction } from "../../supabase/functions/_shared/ai/actionSchema";
import { ADMIN_PERMISSIONS } from "../../supabase/functions/_shared/adminPermissions";
import { usePermissions } from "../hooks/usePermissions";
import { describeAIAction, executeApprovedAIActions } from "../lib/aiActions";
import { activityLabel } from "../lib/display";
import { listProjectActivities } from "../services/activity";
import { listAIModels, requestRocketAI } from "../services/ai";
import { getProjectAnnouncement, listProjectMembers, listProjects } from "../services/projects";
import { listTasks } from "../services/tasks";
import { Button, Spinner, useToast } from "./ui";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: AIAction[];
  actionState?: "pending" | "executed" | "cancelled";
}

export function RocketAIPanel() {
  const permissions = usePermissions();
  const canUseAI = permissions.has(ADMIN_PERMISSIONS.AI_USE);
  const location = useLocation();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [modelId, setModelId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [executingMessageId, setExecutingMessageId] = useState<string | null>(null);
  const routeProjectId = location.pathname.match(/^\/projects\/([0-9a-f-]{36})(?:\/|$)/iu)?.[1] ?? "";
  const projects = useQuery({ queryKey: ["projects"], queryFn: listProjects, enabled: canUseAI });
  const models = useQuery({ queryKey: ["ai-models"], queryFn: listAIModels, enabled: canUseAI });
  const tasks = useQuery({ queryKey: ["tasks", projectId], queryFn: () => listTasks(projectId), enabled: open && Boolean(projectId) });
  const members = useQuery({ queryKey: ["members", projectId], queryFn: () => listProjectMembers(projectId), enabled: open && Boolean(projectId) });
  const activities = useQuery({ queryKey: ["activities", projectId], queryFn: () => listProjectActivities(projectId), enabled: open && Boolean(projectId) });
  const announcement = useQuery({ queryKey: ["project-announcement", projectId], queryFn: () => getProjectAnnouncement(projectId), enabled: open && Boolean(projectId) });
  const selectedProject = projects.data?.find((project) => project.id === projectId);
  const contextReady = Boolean(selectedProject && tasks.data && members.data && activities.data && !announcement.isLoading);

  useEffect(() => {
    if (!routeProjectId) setProjectId("");
  }, [routeProjectId]);
  useEffect(() => {
    if (routeProjectId && projects.data?.some((project) => project.id === routeProjectId)) {
      setProjectId(routeProjectId);
    }
  }, [projects.data, routeProjectId]);
  useEffect(() => {
    if (models.data?.some((model) => model.modelId === modelId)) return;
    setModelId(models.data?.find((model) => model.isDefault)?.modelId ?? models.data?.[0]?.modelId ?? "");
  }, [modelId, models.data]);
  useEffect(() => {
    setMessages([]);
    setConversationId("");
  }, [modelId, projectId]);

  const conversation = useMemo(() => messages
    .map(({ role, content }) => ({ role, content }))
    .slice(-11), [messages]);

  const ask = useMutation({
    mutationFn: async (content: string) => {
      if (!selectedProject || !contextReady || !tasks.data || !members.data || !activities.data) {
        throw new Error("프로젝트 Context를 불러오는 중입니다.");
      }
      return requestRocketAI({
        projectId: selectedProject.id,
        modelId,
        ...(conversationId ? { conversationId } : {}),
        messages: [...conversation, { role: "user" as const, content }].slice(-12),
        context: {
          project: {
            name: selectedProject.name,
            description: selectedProject.description ?? "",
            announcement: announcement.data?.content ?? "",
          },
          members: members.data.map((member) => ({
            id: member.user_id,
            name: member.profile?.name ?? "팀원",
          })),
          tasks: tasks.data.map((task) => ({
            id: task.id,
            title: task.title,
            description: task.description ?? "",
            status: task.status,
            priority: task.priority,
            dueDate: task.due_date,
            assigneeIds: (task.task_assignees ?? []).map((assignee) => assignee.user_id),
          })),
          activities: activities.data.slice(0, 30).map((activity) => ({
            actor: activity.actor?.name ?? "사용자",
            action: activityLabel(activity.action),
            subjectType: activity.subject_type,
            occurredAt: activity.created_at,
          })),
        },
      });
    },
    onSuccess: (result) => {
      setConversationId(result.conversationId);
      const hasMutations = result.actions.some(isMutatingAIAction);
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant" as const,
        content: result.message,
        actions: result.actions,
        ...(hasMutations ? { actionState: "pending" as const } : {}),
      };
      setMessages((current) => [...current, assistantMessage].slice(-30));
    },
    onError: (error) => {
      const content = error instanceof Error ? error.message : "AI 응답을 받아오지 못했습니다.";
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content,
      };
      setMessages((current) => [...current, assistantMessage].slice(-30));
      showToast(content, { tone: "error" });
    },
  });

  const submit = () => {
    const content = prompt.trim();
    if (!content || ask.isPending) return;
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user" as const, content }].slice(-30));
    setPrompt("");
    ask.mutate(content);
  };

  const executeActions = async (message: ChatMessage) => {
    if (!tasks.data || !members.data || !message.actions || executingMessageId) return;
    setExecutingMessageId(message.id);
    try {
      const results = await executeApprovedAIActions({
        projectId,
        actions: message.actions,
        tasks: tasks.data,
        members: members.data,
      });
      const succeeded = results.filter((result) => result.success).length;
      const failed = results.length - succeeded;
      setMessages((current) => current.map((item) => item.id === message.id ? { ...item, actionState: "executed" } : item));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tasks", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["activities", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
      ]);
      if (succeeded) showToast(`${succeeded}개 AI 제안 작업을 실행했습니다.`, { tone: "success" });
      if (failed) showToast(`${failed}개 작업을 실행하지 못했습니다.`, { tone: "error" });
    } finally {
      setExecutingMessageId(null);
    }
  };

  if (!canUseAI) return null;
  return (
    <>
      {!open && (
        <button
          type="button"
          aria-label="Rocket AI 열기"
          title="Rocket AI"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-[80] flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white shadow-2xl transition hover:-translate-y-0.5 hover:bg-brand/90"
        >
          <Sparkles size={22} />
        </button>
      )}
      {open && (
        <aside className="fixed inset-0 z-[90] flex flex-col border-line bg-surface shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[430px] sm:border-l" aria-label="Rocket AI">
          <header className="border-b border-line p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2"><Bot size={19} className="text-brand" /><h2 className="font-extrabold text-ink">Rocket AI</h2></div>
              <Button variant="ghost" className="h-8 w-8 p-0" aria-label="Rocket AI 닫기" onClick={() => setOpen(false)}><X size={17} /></Button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <select className="field h-9 text-xs" aria-label="AI 프로젝트" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                <option value="">프로젝트 선택</option>
                {(projects.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
              <select className="field h-9 text-xs" aria-label="AI 모델" value={modelId} onChange={(event) => setModelId(event.target.value)}>
                {(models.data ?? []).map((model) => <option key={model.modelId} value={model.modelId}>{model.displayName}</option>)}
              </select>
            </div>
            <p className="mt-3 rounded-xl bg-raised px-3 py-2 text-[10px] leading-4 text-muted">
              Rocket AI는 프로젝트 작업·일정·담당자·진행 상황 관리 전용입니다. 코딩·과제·문서 작성·일반 질문은 지원하지 않습니다. 대화 기록은 운영 및 오남용 방지를 위해 저장되며 관리자가 확인할 수 있습니다.
            </p>
          </header>
          <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto p-4">
            {!messages.length && (
              <div className="rounded-2xl border border-line bg-raised p-4 text-sm leading-6 text-muted">
                프로젝트 작업을 요약하거나 작업 생성·상태 변경·담당자 배정을 요청할 수 있습니다. 변경 제안은 실행 전 반드시 확인합니다.
              </div>
            )}
            {messages.map((message) => {
              const mutatingActions = message.actions?.filter(isMutatingAIAction) ?? [];
              return (
                <div key={message.id} className={message.role === "user" ? "ml-10" : "mr-6"}>
                  <div className={message.role === "user" ? "rounded-2xl bg-brand px-4 py-3 text-sm leading-6 text-white" : "rounded-2xl border border-line bg-raised px-4 py-3 text-sm leading-6 text-ink"}>
                    <p className="whitespace-pre-wrap break-words">{message.content}</p>
                  </div>
                  {mutatingActions.length > 0 && (
                    <div className="mt-2 rounded-2xl border border-brand/20 bg-brand/[.04] p-3">
                      <p className="text-xs font-extrabold text-ink">실행 전 확인 · {mutatingActions.length}개 변경</p>
                      <ul className="mt-2 space-y-1.5 text-xs leading-5 text-muted">
                        {mutatingActions.map((action, index) => <li key={`${message.id}-${index}`}>• {describeAIAction(action, tasks.data ?? [], members.data ?? [])}</li>)}
                      </ul>
                      {message.actionState === "pending" ? (
                        <div className="mt-3 flex gap-2">
                          <Button size="sm" disabled={executingMessageId !== null} onClick={() => void executeActions(message)}>
                            {executingMessageId === message.id ? <Spinner className="h-3.5 w-3.5" /> : <Check size={13} />} 실행
                          </Button>
                          <Button size="sm" variant="secondary" disabled={executingMessageId !== null} onClick={() => setMessages((current) => current.map((item) => item.id === message.id ? { ...item, actionState: "cancelled" } : item))}>취소</Button>
                        </div>
                      ) : (
                        <p className="mt-2 text-[11px] font-semibold text-muted">{message.actionState === "executed" ? "실행 처리됨" : "취소됨"}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {ask.isPending && <div className="mr-20 flex items-center gap-2 rounded-2xl border border-line bg-raised p-3 text-xs text-muted"><Spinner className="h-4 w-4" /> AI가 프로젝트를 확인하고 있습니다.</div>}
          </div>
          <footer className="border-t border-line p-4">
            {!models.isLoading && !models.data?.length && <p className="mb-2 text-xs text-amber-700 dark:text-amber-300">현재 활성화된 AI 모델이 없습니다.</p>}
            <div className="flex items-end gap-2">
              <textarea
                className="field min-h-11 max-h-32 flex-1 resize-y py-2.5 text-sm"
                value={prompt}
                maxLength={4_000}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
                placeholder="프로젝트 작업을 요청하세요..."
                aria-label="AI 메시지"
              />
              <Button className="h-11 w-11 p-0" aria-label="AI 메시지 전송" disabled={!prompt.trim() || !projectId || !modelId || !contextReady || ask.isPending} onClick={submit}>
                <Send size={16} />
              </Button>
            </div>
          </footer>
        </aside>
      )}
    </>
  );
}
