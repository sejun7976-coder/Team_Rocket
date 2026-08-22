import { invokeAuthenticatedFunction } from "../lib/authenticatedFunction";
import type { TaskPriority } from "../types/domain";

export type AIIntent = "chat" | "create_task" | "split_task" | "project_briefing" | "project_summary" | "weekly_report" | "project_qa" | "github_summary";
export interface AITaskProposal { title: string; description: string; priority: TaskPriority; dueDate: string | null; assigneeIds: string[] }
export interface AIModelChoice { id: string; modelId: string; family: string; displayName: string; isDefault: boolean }
export interface RocketAIResponse { intent: AIIntent; kind: "task_proposal" | "answer"; summary: string; tasks: AITaskProposal[]; model: { id: string; family: string; displayName: string } }
export interface AIGatewayStatus { enabled: boolean; configured: boolean; baseUrl: string; updatedAt: string | null }
export interface AIModelSetting { id: string; family: string; model_id: string; display_name: string; enabled: boolean; is_default: boolean; sort_order: number; is_builtin: boolean; created_at: string; updated_at: string }
export interface AISettingsStatus { gateway: AIGatewayStatus; models: AIModelSetting[] }
export interface AIConversationMessage { role: "user" | "assistant"; content: string }

export async function listAIModels(): Promise<AIModelChoice[]> {
  const data = await invokeAuthenticatedFunction<{ models: AIModelChoice[] }>("ai-models", { body: {}, fallbackMessage: "AI 모델 목록을 불러올 수 없습니다." });
  return data.models;
}

export async function requestRocketAI(input: { projectId: string; modelSettingId: string; messages: AIConversationMessage[]; context: Record<string, unknown> }): Promise<RocketAIResponse> {
  return invokeAuthenticatedFunction("ai-assistant", { body: input, fallbackMessage: "Rocket AI 요청을 처리할 수 없습니다." });
}

export async function getAISettings(): Promise<AISettingsStatus> {
  return invokeAuthenticatedFunction("admin-ai-settings", { body: { action: "get" }, fallbackMessage: "AI 설정을 불러올 수 없습니다." });
}

export async function saveAIGateway(input: { enabled: boolean; baseUrl: string; apiKey?: string }): Promise<AISettingsStatus> {
  return invokeAuthenticatedFunction("admin-ai-settings", { body: { action: "save_gateway", ...input }, fallbackMessage: "AI Gateway 설정을 저장할 수 없습니다." });
}

export async function testAIConnection(): Promise<void> {
  await invokeAuthenticatedFunction("admin-ai-settings", { body: { action: "test" }, fallbackMessage: "AI Gateway 연결 테스트에 실패했습니다." });
}

export async function addAIModel(input: { family: string; modelId: string; displayName: string; enabled?: boolean; isDefault?: boolean; sortOrder?: number }): Promise<AISettingsStatus> {
  return invokeAuthenticatedFunction("admin-ai-settings", { body: { action: "add_model", ...input }, fallbackMessage: "AI 모델을 추가할 수 없습니다." });
}

export async function updateAIModel(input: { modelSettingId: string; family?: string; modelId?: string; displayName?: string; enabled?: boolean; isDefault?: boolean; sortOrder?: number }): Promise<AISettingsStatus> {
  return invokeAuthenticatedFunction("admin-ai-settings", { body: { action: "update_model", ...input }, fallbackMessage: "AI 모델을 수정할 수 없습니다." });
}

export async function deleteAIModel(modelSettingId: string): Promise<AISettingsStatus> {
  return invokeAuthenticatedFunction("admin-ai-settings", { body: { action: "delete_model", modelSettingId }, fallbackMessage: "Custom AI 모델을 삭제할 수 없습니다." });
}
