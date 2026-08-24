import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, RotateCcw, ShieldAlert, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { ADMIN_PERMISSIONS } from "../../supabase/functions/_shared/adminPermissions";
import { Badge, Button, EmptyState, Modal, PageHeader, Spinner, useToast } from "../components/ui";
import { usePermissions } from "../hooks/usePermissions";
import {
  getAIConversation,
  getAIConversationFilters,
  listAIPolicyEvents,
  listAIConversations,
  listAIManagedUsers,
  resetAIUserPolicy,
} from "../services/ai";

const policyLabels: Record<string, string> = {
  normal: "정상",
  uncertain: "UNCERTAIN",
  warning: "경고",
  bypass: "우회 시도",
  output_blocked: "응답 차단",
  suspended: "사용 제한",
  guard_error: "Guard 오류",
  unsupported: "미지원 기능",
};

const eventLabels: Record<string, string> = {
  warning: "정책 경고",
  suspension: "AI 사용 제한",
  reset: "관리자 제한 해제",
  output_blocked: "AI 응답 차단",
  project_data_injection: "프로젝트 데이터 Injection",
};

function displayDate(value: string | null): string {
  return value ? new Date(value).toLocaleString("ko-KR") : "-";
}

export function AdminAILogsPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const permissions = usePermissions();
  const canReset = permissions.has(ADMIN_PERMISSIONS.AI_MANAGE);
  const [userId, setUserId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [modelId, setModelId] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const users = useQuery({ queryKey: ["ai-managed-users"], queryFn: listAIManagedUsers });
  const filterOptions = useQuery({ queryKey: ["ai-log-filters"], queryFn: getAIConversationFilters });
  const queryFilters = useMemo(() => ({
    ...(userId ? { userId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(modelId ? { modelId } : {}),
    ...(status ? { status } : {}),
    ...(from ? { from: `${from}T00:00:00.000Z` } : {}),
    ...(to ? { to: `${to}T23:59:59.999Z` } : {}),
  }), [from, modelId, projectId, status, to, userId]);
  const conversations = useQuery({
    queryKey: ["ai-conversations", queryFilters],
    queryFn: () => listAIConversations(queryFilters),
  });
  const eventFilters = useMemo(() => ({
    ...(userId ? { userId } : {}),
    ...(from ? { from: `${from}T00:00:00.000Z` } : {}),
    ...(to ? { to: `${to}T23:59:59.999Z` } : {}),
  }), [from, to, userId]);
  const policyEvents = useQuery({
    queryKey: ["ai-policy-events", eventFilters],
    queryFn: () => listAIPolicyEvents(eventFilters),
  });
  const detail = useQuery({
    queryKey: ["ai-conversation", selectedId],
    queryFn: () => getAIConversation(selectedId!),
    enabled: Boolean(selectedId),
  });
  const reset = useMutation({
    mutationFn: resetAIUserPolicy,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["ai-managed-users"] });
      showToast("AI 사용 제한을 해제했습니다.", { tone: "success" });
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "AI 사용 제한을 해제하지 못했습니다.", { tone: "error" }),
  });

  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="AI 운영"
        title="AI 사용자 및 대화 기록"
        description="정책 경고·사용 제한 상태와 저장된 Rocket AI 대화를 확인합니다. Admin 계정과 AI 대화 기록 조회 권한이 모두 필요합니다."
      />

      <section className="panel mb-5 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-5 py-4">
          <Users size={17} className="text-brand" />
          <h2 className="text-sm font-extrabold text-ink">AI 사용자 관리</h2>
        </div>
        {users.isLoading ? (
          <div className="flex min-h-32 items-center justify-center"><Spinner /></div>
        ) : (
          <div className="divide-y divide-line">
            {(users.data ?? []).map((user) => (
              <div key={user.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-ink">{user.name}</p>
                  <p className="text-[10px] text-muted">{user.student_id} · {user.system_role === "admin" ? "Admin" : "User"}</p>
                </div>
                <Badge tone={user.suspended ? "red" : user.warningCount ? "amber" : "green"}>
                  {user.suspended ? "사용 제한" : user.warningCount ? "경고" : "정상"}
                </Badge>
                <div className="text-xs text-muted">
                  <strong className="text-ink">{user.warningCount}/3</strong> · 최근 {displayDate(user.lastAiUsedAt)}
                </div>
                <div>
                  {user.suspended && canReset && (
                    <Button size="sm" variant="secondary" disabled={reset.isPending} onClick={() => reset.mutate(user.id)}>
                      <RotateCcw size={13} /> 제한 해제
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel mb-5 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-5 py-4">
          <ShieldAlert size={17} className="text-brand" />
          <div>
            <h2 className="text-sm font-extrabold text-ink">정책 감사 이력</h2>
            <p className="mt-1 text-xs text-muted">경고·사용 제한·응답 차단·관리자 해제 이력은 상태 초기화 후에도 보존됩니다.</p>
          </div>
        </div>
        {policyEvents.isLoading ? (
          <div className="flex min-h-28 items-center justify-center"><Spinner /></div>
        ) : policyEvents.data?.length ? (
          <div className="max-h-80 divide-y divide-line overflow-y-auto">
            {policyEvents.data.map((event) => (
              <div key={event.id} className="grid gap-2 px-5 py-3 text-xs sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <p className="font-bold text-ink">{event.user_name_snapshot} · {eventLabels[event.event_type] ?? event.event_type}</p>
                  <p className="mt-1 truncate text-muted">
                    {event.scope_decision ?? "관리자 작업"}{event.scope_category ? ` · ${event.scope_category}` : ""}{event.warning_number ? ` · 경고 ${event.warning_number}/3` : ""}
                  </p>
                </div>
                <p className="text-muted">{displayDate(event.created_at)}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="p-6 text-center text-sm text-muted">정책 감사 이력이 없습니다.</p>
        )}
      </section>

      <section className="panel overflow-hidden">
        <div className="border-b border-line p-5">
          <div className="flex items-center gap-2"><History size={17} className="text-brand" /><h2 className="text-sm font-extrabold text-ink">AI 대화 기록</h2></div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
            <select className="field text-xs" aria-label="사용자 필터" value={userId} onChange={(event) => setUserId(event.target.value)}>
              <option value="">모든 사용자</option>
              {(filterOptions.data?.users ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <select className="field text-xs" aria-label="프로젝트 필터" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="">모든 프로젝트</option>
              {(filterOptions.data?.projects ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <select className="field text-xs" aria-label="모델 필터" value={modelId} onChange={(event) => setModelId(event.target.value)}>
              <option value="">모든 모델</option>
              {(filterOptions.data?.models ?? []).map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select className="field text-xs" aria-label="정책 상태 필터" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">모든 상태</option>
              {(filterOptions.data?.statuses ?? []).map((item) => <option key={item} value={item}>{policyLabels[item] ?? item}</option>)}
            </select>
            <input className="field text-xs" type="date" aria-label="시작 날짜" value={from} onChange={(event) => setFrom(event.target.value)} />
            <input className="field text-xs" type="date" aria-label="종료 날짜" value={to} onChange={(event) => setTo(event.target.value)} />
          </div>
        </div>
        {conversations.isLoading ? (
          <div className="flex min-h-40 items-center justify-center"><Spinner /></div>
        ) : conversations.data?.conversations.length ? (
          <div className="divide-y divide-line">
            {conversations.data.conversations.map((conversation) => (
              <button key={conversation.id} type="button" className="grid w-full gap-2 px-5 py-4 text-left transition hover:bg-raised sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center" onClick={() => setSelectedId(conversation.id)}>
                <div className="min-w-0"><p className="truncate text-sm font-bold text-ink">{conversation.user_name_snapshot}</p><p className="truncate text-xs text-muted">{conversation.project_name_snapshot} · {conversation.model_id}</p></div>
                <p className="text-xs text-muted">{displayDate(conversation.updated_at)} · 메시지 {conversation.messages[0]?.count ?? 0}개</p>
                <Badge tone={conversation.last_policy_status === "suspended" ? "red" : ["warning", "bypass"].includes(conversation.last_policy_status) ? "amber" : "neutral"}>{policyLabels[conversation.last_policy_status] ?? conversation.last_policy_status}</Badge>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState icon={<History />} title="저장된 AI 대화가 없습니다" description="Rocket AI 사용 기록이 여기에 표시됩니다." />
        )}
      </section>

      <Modal open={Boolean(selectedId)} onClose={() => setSelectedId(null)} title="AI 대화 상세" className="max-w-3xl">
        {detail.isLoading ? <div className="flex min-h-40 items-center justify-center"><Spinner /></div> : detail.data ? (
          <div>
            <div className="mb-4 rounded-xl bg-raised p-3 text-xs leading-5 text-muted">
              <strong className="text-ink">{detail.data.conversation.user_name_snapshot}</strong> · {detail.data.conversation.project_name_snapshot}<br />
              {detail.data.conversation.model_id} · {displayDate(detail.data.conversation.created_at)}
            </div>
            <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {detail.data.messages.map((message) => (
                <article key={message.id} className={message.role === "user" ? "ml-8 rounded-xl bg-brand/10 p-3" : "mr-8 rounded-xl border border-line p-3"}>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted">
                    <strong className="text-ink">{message.role === "user" ? "사용자" : "Rocket AI"}</strong>
                    <span>{displayDate(message.created_at)}</span>
                    <Badge tone={message.policy_status === "suspended" ? "red" : ["warning", "bypass"].includes(message.policy_status) ? "amber" : "neutral"}>{policyLabels[message.policy_status] ?? message.policy_status}</Badge>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-ink">{message.content}</p>
                  {message.scope_decision && (
                    <div className="mt-3 rounded-lg bg-surface p-2 text-[10px] leading-4 text-muted">
                      정책 판정 {message.scope_decision} · 분류 {message.scope_category ?? "-"}
                      {message.warning_number ? ` · 경고 ${message.warning_number}/3` : ""}
                      {message.scope_reason ? <p className="mt-1">{message.scope_reason}</p> : null}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>
        ) : <EmptyState icon={<ShieldAlert />} title="대화를 불러올 수 없습니다" description="잠시 후 다시 시도해 주세요." />}
      </Modal>
    </div>
  );
}
