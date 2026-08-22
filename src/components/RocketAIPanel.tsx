import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, MessageSquarePlus, Minus, Search, Send, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useLocation } from "react-router-dom";
import { listAIModels, requestRocketAI, type AIConversationMessage, type AIModelChoice, type RocketAIResponse } from "../services/ai";
import { listProjectMembers, listProjects } from "../services/projects";
import { createTask, listTasks } from "../services/tasks";
import { useRocketAIStore } from "../stores/rocketAIStore";
import { Alert, Badge, Button, Input, Spinner } from "./ui";

interface ChatMessage extends AIConversationMessage {
  id: string;
  createdAt: string;
  model?: string;
  proposal?: RocketAIResponse;
}

function groupModels(models: AIModelChoice[]) {
  return models.reduce<Record<string, AIModelChoice[]>>((groups, model) => {
    (groups[model.family] ??= []).push(model);
    return groups;
  }, {});
}

function withoutProposal(message: ChatMessage): ChatMessage {
  const remaining = { ...message };
  delete remaining.proposal;
  return remaining;
}

export function RocketAIPanel() {
  const { pathname } = useLocation();
  const opened = useRocketAIStore((state) => state.opened);
  const minimized = useRocketAIStore((state) => state.minimized);
  const open = useRocketAIStore((state) => state.open);
  const close = useRocketAIStore((state) => state.close);
  const minimize = useRocketAIStore((state) => state.minimize);
  const queryClient = useQueryClient();
  const pickerRef = useRef<HTMLDivElement>(null);
  const projects = useQuery({ queryKey: ["projects"], queryFn: listProjects, enabled: opened });
  const models = useQuery({ queryKey: ["ai-models"], queryFn: listAIModels, enabled: opened });
  const routeProjectId = pathname.match(/^\/projects\/([0-9a-f-]{36})(?:\/|$)/iu)?.[1] ?? "";
  const [projectId, setProjectId] = useState("");
  const [modelId, setModelId] = useState(() => localStorage.getItem("rocket-ai:model") ?? "");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const tasks = useQuery({ queryKey: ["tasks", projectId], queryFn: () => listTasks(projectId), enabled: opened && Boolean(projectId) });
  const members = useQuery({ queryKey: ["members", projectId], queryFn: () => listProjectMembers(projectId), enabled: opened && Boolean(projectId) });

  useEffect(() => {
    if (routeProjectId && projects.data?.some((item) => item.id === routeProjectId)) setProjectId(routeProjectId);
    else if (!projectId && projects.data?.[0]) setProjectId(projects.data[0].id);
  }, [projectId, projects.data, routeProjectId]);

  useEffect(() => {
    if (!models.data?.length) return;
    const selected = models.data.some((model) => model.id === modelId)
      ? modelId
      : (models.data.find((model) => model.isDefault)?.id ?? models.data[0]!.id);
    setModelId(selected);
    localStorage.setItem("rocket-ai:model", selected);
  }, [modelId, models.data]);

  useEffect(() => {
    if (!pickerOpen) return;
    const closePicker = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", closePicker);
    return () => document.removeEventListener("mousedown", closePicker);
  }, [pickerOpen]);

  const context = useMemo(() => ({
    project: projects.data?.find((item) => item.id === projectId)
      ? { name: projects.data.find((item) => item.id === projectId)!.name, status: projects.data.find((item) => item.id === projectId)!.status }
      : null,
    members: members.data?.map((member) => ({ id: member.user_id, name: member.profile?.name, studentId: member.profile?.student_id })) ?? [],
    tasks: tasks.data?.slice(0, 100).map((task) => ({ id: task.id, title: task.title, description: task.description, status: task.status, priority: task.priority, dueDate: task.due_date, progress: task.progress, assigneeIds: task.task_assignees?.map((item) => item.user_id) ?? [] })) ?? [],
  }), [members.data, projectId, projects.data, tasks.data]);
  const selectedModel = models.data?.find((model) => model.id === modelId);
  const visibleModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    return (models.data ?? []).filter((model) => !query || model.displayName.toLowerCase().includes(query) || model.modelId.toLowerCase().includes(query));
  }, [modelSearch, models.data]);
  const groupedModels = groupModels(visibleModels);

  const ask = useMutation({
    mutationFn: async () => {
      const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: prompt.trim(), createdAt: new Date().toISOString() };
      const recent = [...messages, userMessage].slice(-20).map(({ role, content }) => ({ role, content }));
      setMessages((current) => [...current, userMessage]);
      setPrompt("");
      return requestRocketAI({ projectId, modelSettingId: modelId, messages: recent, context });
    },
    onSuccess: (result) => setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: result.summary, createdAt: new Date().toISOString(), model: result.model.displayName, proposal: result }]),
  });
  const apply = useMutation({
    mutationFn: async ({ proposal }: { messageId: string; proposal: RocketAIResponse }) => {
      if (proposal.kind !== "task_proposal") return;
      for (const task of proposal.tasks) {
        await createTask({ projectId, title: task.title, description: task.description, priority: task.priority, dueDate: task.dueDate ?? undefined, assigneeIds: task.assigneeIds });
      }
    },
    onSuccess: async (_, { messageId }) => {
      setMessages((current) => current.map((message) => message.id === messageId ? withoutProposal(message) : message));
      await queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
    },
  });
  const cancelProposal = (messageId: string) => setMessages((current) => current.map((message) => message.id === messageId ? withoutProposal(message) : message));
  const selectModel = (id: string) => {
    setModelId(id);
    localStorage.setItem("rocket-ai:model", id);
    setPickerOpen(false);
    setModelSearch("");
  };
  const submit = () => { if (projectId && modelId && prompt.trim() && !ask.isPending) ask.mutate(); };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); }
  };

  if (!opened) return null;
  if (minimized) return <button onClick={open} className="fixed bottom-5 right-5 z-[70] flex items-center gap-2 rounded-full bg-brand px-4 py-3 text-sm font-bold text-white shadow-lift"><Sparkles size={18} /> Rocket AI</button>;
  return (
    <aside aria-label="Rocket AI" className="fixed bottom-4 right-4 z-[70] flex h-[min(680px,calc(100vh-2rem))] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2"><Sparkles size={18} className="text-brand" /><div><h2 className="text-sm font-extrabold text-ink">Rocket AI</h2><p className="text-[10px] text-muted">제안은 확인 후에만 적용됩니다.</p></div></div>
        <div className="flex">
          <Button variant="ghost" className="h-8 w-8 p-0" title="새 대화" onClick={() => setMessages([])}><MessageSquarePlus size={16} /></Button>
          <Button variant="ghost" className="h-8 w-8 p-0" title="최소화" onClick={minimize}><Minus size={16} /></Button>
          <Button variant="ghost" className="h-8 w-8 p-0" title="닫기" onClick={close}><X size={16} /></Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && <div className="rounded-2xl bg-raised p-4 text-sm leading-6 text-muted">프로젝트 맥락을 바탕으로 질문하거나 Task 제안을 요청하세요.</div>}
        {messages.map((message) => (
          <div key={message.id} className={message.role === "user" ? "ml-8 rounded-2xl rounded-br-md bg-brand p-3 text-sm text-white" : "mr-4 rounded-2xl rounded-bl-md border border-line bg-raised p-3 text-sm text-ink"}>
            <p className="whitespace-pre-wrap leading-6">{message.content}</p>
            {message.model && <p className="mt-2 text-[10px] text-muted">{message.model} · {new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(message.createdAt))}</p>}
            {message.proposal?.tasks.map((task, index) => (
              <article key={`${task.title}-${index}`} className="mt-2 rounded-xl border border-line bg-surface p-2.5">
                <p className="font-bold">{task.title}</p>
                {task.description && <p className="mt-1 text-xs leading-5 text-muted">{task.description}</p>}
                <div className="mt-1 flex flex-wrap gap-1"><Badge>{task.priority}</Badge>{task.dueDate && <Badge>{task.dueDate}</Badge>}{task.assigneeIds.length > 0 && <Badge>담당자 {task.assigneeIds.length}명</Badge>}</div>
              </article>
            ))}
            {message.proposal?.kind === "task_proposal" && (
              <div className="mt-3 flex justify-end gap-2">
                <Button size="sm" variant="secondary" disabled={apply.isPending} onClick={() => cancelProposal(message.id)}>취소</Button>
                <Button size="sm" disabled={apply.isPending} onClick={() => apply.mutate({ messageId: message.id, proposal: message.proposal! })}><Check size={14} /> 작업 생성</Button>
              </div>
            )}
          </div>
        ))}
        {ask.isPending && <div className="mr-24 rounded-2xl bg-raised p-3"><Spinner className="h-4 w-4" /></div>}
        {(ask.error || models.error || apply.error) && <Alert>{ask.error?.message ?? models.error?.message ?? apply.error?.message}</Alert>}
      </div>
      <footer className="border-t border-line p-3">
        <p className="mb-2 truncate text-[10px] font-semibold text-muted">현재 프로젝트: {projects.data?.find((item) => item.id === projectId)?.name ?? "선택 안 됨"}</p>
        <div className="flex items-end gap-2">
          <div ref={pickerRef} className="relative shrink-0">
            {pickerOpen && (
              <div className="absolute bottom-full left-0 z-10 mb-2 max-h-80 w-72 overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
                <div className="border-b border-line p-3"><p className="mb-2 text-xs font-extrabold text-ink">모델 선택</p><div className="relative"><Search className="absolute left-2.5 top-2.5 text-muted" size={14} /><Input aria-label="AI 모델 검색" className="h-9 pl-8 text-xs" value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="이름 또는 Model ID 검색" autoFocus /></div></div>
                <div className="max-h-60 overflow-y-auto p-2">
                  {Object.entries(groupedModels).map(([family, familyModels]) => <div key={family} className="mb-2 last:mb-0"><p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-muted">{family}</p>{familyModels.map((model) => <button key={model.id} type="button" className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-raised" onClick={() => selectModel(model.id)}><Check size={13} className={model.id === modelId ? "text-brand" : "invisible"} /><span className="min-w-0"><span className="block truncate text-xs font-bold text-ink">{model.displayName}</span><span className="block truncate font-mono text-[10px] text-muted">{model.modelId}</span></span></button>)}</div>)}
                  {visibleModels.length === 0 && <p className="p-3 text-center text-xs text-muted">검색 결과가 없습니다.</p>}
                </div>
              </div>
            )}
            <Button variant="secondary" className="h-11 max-w-36 gap-1 px-2 text-xs" title={selectedModel?.displayName ?? "모델 선택"} onClick={() => setPickerOpen((value) => !value)}><span className="truncate">{selectedModel?.displayName ?? "모델 선택"}</span><ChevronDown size={13} /></Button>
          </div>
          <textarea aria-label="Rocket AI 메시지" className="field max-h-28 min-h-11 min-w-0 resize-none py-2.5 text-sm" value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={keyDown} placeholder="메시지 입력" />
          <Button className="h-11 w-11 shrink-0 p-0" disabled={!projectId || !modelId || !prompt.trim() || ask.isPending} onClick={submit}><Send size={16} /></Button>
        </div>
      </footer>
    </aside>
  );
}
