import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Check, PlugZap, RotateCcw, Star, Users } from "lucide-react";
import { Badge, Button, PageHeader, Spinner, useToast } from "../components/ui";
import {
  getAISettings,
  listAIManagedUsersForManagement,
  resetAIUserPolicy,
  setAIGuardModel,
  setAIModelState,
  testAIConnection,
} from "../services/ai";

const familyLabels: Record<string, string> = {
  openai: "OpenAI",
  claude: "Claude",
  gemini: "Gemini",
  grok: "Grok",
  gemma: "Gemma",
  perplexity: "Perplexity",
  upstage: "Upstage",
  exaone: "EXAONE",
  qwen: "Qwen",
  glm: "GLM",
  kimi: "Kimi",
  seed: "Seed",
  deepseek: "DeepSeek",
};

function displayDate(value: string | null): string {
  return value ? new Date(value).toLocaleString("ko-KR") : "사용 기록 없음";
}

export function AdminAISettingsPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const settings = useQuery({ queryKey: ["ai-settings"], queryFn: getAISettings });
  const managedUsers = useQuery({
    queryKey: ["ai-managed-users-for-management"],
    queryFn: listAIManagedUsersForManagement,
  });
  const stateMutation = useMutation({
    mutationFn: setAIModelState,
    onSuccess: (data) => {
      queryClient.setQueryData(["ai-settings"], data);
      void queryClient.invalidateQueries({ queryKey: ["ai-models"] });
      showToast("AI 모델 설정이 변경되었습니다.", { tone: "success" });
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "AI 모델 설정을 변경하지 못했습니다.", { tone: "error" }),
  });
  const testMutation = useMutation({
    mutationFn: testAIConnection,
    onSuccess: () => showToast("AI Gateway 연결에 성공했습니다.", { tone: "success" }),
    onError: () => showToast("AI Gateway에 연결하지 못했습니다.", { tone: "error" }),
  });
  const guardMutation = useMutation({
    mutationFn: setAIGuardModel,
    onSuccess: (data) => {
      queryClient.setQueryData(["ai-settings"], data);
      showToast("Guard Model이 변경되었습니다.", { tone: "success" });
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "Guard Model을 변경하지 못했습니다.", { tone: "error" }),
  });
  const resetMutation = useMutation({
    mutationFn: resetAIUserPolicy,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ai-managed-users-for-management"] }),
        queryClient.invalidateQueries({ queryKey: ["ai-managed-users"] }),
      ]);
      showToast("AI 사용 제한을 해제했습니다.", { tone: "success" });
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "AI 사용 제한을 해제하지 못했습니다.", { tone: "error" }),
  });
  const groups = new Map<string, NonNullable<typeof settings.data>["models"]>();
  for (const model of settings.data?.models ?? []) {
    groups.set(model.family, [...(groups.get(model.family) ?? []), model]);
  }

  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="관리"
        title="AI 설정"
        description="단일 Gateway를 통해 사용할 모델과 기본 모델을 관리합니다."
      />
      <section className="panel mb-5 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand"><PlugZap size={19} /></span>
          <div>
            <h2 className="text-sm font-extrabold text-ink">AI Gateway</h2>
            <p className="mt-1 text-xs text-muted">
              {settings.data?.gateway.configured
                ? "Edge Function Secret이 설정되어 있습니다."
                : "AI_GATEWAY_BASE_URL과 AI_GATEWAY_API_KEY Secret을 설정해 주세요."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={settings.data?.gateway.configured ? "green" : "amber"}>
            {settings.data?.gateway.configured ? "설정됨" : "설정 필요"}
          </Badge>
          <Button
            variant="secondary"
            size="sm"
            disabled={!settings.data?.gateway.configured || testMutation.isPending}
            onClick={() => testMutation.mutate()}
          >
            {testMutation.isPending ? <Spinner className="h-4 w-4" /> : <PlugZap size={14} />} 연결 테스트
          </Button>
        </div>
      </section>

      <section className="panel mb-5 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-extrabold text-ink">Guard Model</h2>
            <p className="mt-1 text-xs leading-5 text-muted">사용자 요청과 AI 응답이 프로젝트 관리 범위인지 판정하는 활성 모델입니다.</p>
          </div>
          <select
            className="field w-full sm:w-72"
            aria-label="Guard Model"
            value={settings.data?.guardModelId ?? ""}
            disabled={settings.isLoading || guardMutation.isPending}
            onChange={(event) => guardMutation.mutate(event.target.value)}
          >
            <option value="" disabled>활성 모델 선택</option>
            {(settings.data?.models ?? []).filter((model) => model.enabled).map((model) => (
              <option key={model.modelId} value={model.modelId}>{model.displayName}</option>
            ))}
          </select>
        </div>
      </section>

      <section className="panel mb-5 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-5 py-4">
          <Users size={17} className="text-brand" />
          <div>
            <h2 className="text-sm font-extrabold text-ink">AI 사용자 관리</h2>
            <p className="mt-1 text-xs text-muted">경고 상태를 확인하고 사용 제한을 해제합니다. 과거 정책 이력은 삭제되지 않습니다.</p>
          </div>
        </div>
        {managedUsers.isLoading ? (
          <div className="flex min-h-32 items-center justify-center"><Spinner /></div>
        ) : (
          <div className="max-h-96 divide-y divide-line overflow-y-auto">
            {(managedUsers.data ?? []).map((managedUser) => (
              <div key={managedUser.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-ink">{managedUser.name}</p>
                  <p className="text-[10px] text-muted">{managedUser.student_id} · {managedUser.system_role === "admin" ? "Admin" : "User"}</p>
                </div>
                <Badge tone={managedUser.suspended ? "red" : managedUser.warningCount ? "amber" : managedUser.account_status === "active" ? "green" : "neutral"}>
                  {managedUser.suspended ? "사용 제한" : managedUser.warningCount ? "경고" : managedUser.account_status === "active" ? "정상" : "계정 비활성"}
                </Badge>
                <p className="text-xs text-muted">
                  <strong className="text-ink">{managedUser.warningCount}/3</strong><br />
                  최근 {displayDate(managedUser.lastAiUsedAt)}
                </p>
                <div>
                  {managedUser.suspended && (
                    <Button size="sm" variant="secondary" disabled={resetMutation.isPending} onClick={() => resetMutation.mutate(managedUser.id)}>
                      <RotateCcw size={13} /> 제한 해제
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {settings.isLoading ? (
        <div className="flex min-h-64 items-center justify-center"><Spinner /></div>
      ) : settings.error ? (
        <div className="panel p-5 text-sm text-red-600">AI 설정을 불러오지 못했습니다.</div>
      ) : (
        <div className="space-y-5">
          {[...groups.entries()].map(([family, models]) => (
            <section key={family} className="panel overflow-hidden">
              <div className="flex items-center gap-2 border-b border-line px-5 py-4">
                <Bot size={16} className="text-brand" />
                <h2 className="text-sm font-extrabold text-ink">{familyLabels[family] ?? family}</h2>
              </div>
              <div className="divide-y divide-line">
                {models.map((model) => (
                  <div key={model.modelId} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm text-ink">{model.displayName}</strong>
                        {model.isDefault && <Badge tone="purple"><Star size={10} /> 기본 모델</Badge>}
                      </div>
                      <code className="mt-1 block break-all text-[10px] text-muted">{model.modelId}</code>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!model.enabled || model.isDefault || stateMutation.isPending}
                        onClick={() => stateMutation.mutate({ modelId: model.modelId, enabled: true, makeDefault: true })}
                      >
                        <Star size={13} /> 기본 지정
                      </Button>
                      <Button
                        size="sm"
                        variant={model.enabled ? "secondary" : "primary"}
                        disabled={stateMutation.isPending}
                        onClick={() => stateMutation.mutate({ modelId: model.modelId, enabled: !model.enabled, makeDefault: false })}
                      >
                        {model.enabled && <Check size={13} />}{model.enabled ? "활성" : "비활성"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
