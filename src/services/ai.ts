import { invokeAuthenticatedFunction } from "../lib/authenticatedFunction";
import type { TaskPriority } from "../types/domain";

export type AIProvider = "openai" | "anthropic" | "google";
export type AIFeature = "create_task" | "decompose_tasks" | "briefing" | "project_summary" | "weekly_report" | "project_qa" | "github_summary";
export interface AITaskProposal { title: string; description: string; priority: TaskPriority; dueDate: string | null; assigneeIds: string[] }
export interface AIModelChoice { id: string; provider: AIProvider; displayName: string; isDefault: boolean }
export interface RocketAIResponse { kind: "task_proposal" | "answer"; summary: string; tasks: AITaskProposal[]; model: { id: string; provider: AIProvider; displayName: string } }
export interface AIProviderStatus { provider: AIProvider; enabled: boolean; configured: boolean; updatedAt: string | null }
export interface AIModelSetting { id: string; provider: AIProvider; model_id: string; display_name: string; enabled: boolean; is_default: boolean; sort_order: number; created_at: string; updated_at: string }
export interface AISettingsStatus { providers: AIProviderStatus[]; models: AIModelSetting[] }
export interface AIConversationMessage { role: "user" | "assistant"; content: string }

export async function listAIModels(): Promise<AIModelChoice[]> { const data = await invokeAuthenticatedFunction<{ models: AIModelChoice[] }>("ai-models", { body: {}, fallbackMessage: "AI 모델 목록을 불러올 수 없습니다." }); return data.models; }
export async function requestRocketAI(input: { projectId: string; modelSettingId: string; feature: AIFeature; messages: AIConversationMessage[]; context: Record<string, unknown> }): Promise<RocketAIResponse> { return invokeAuthenticatedFunction("ai-assistant", { body: input, fallbackMessage: "Rocket AI 요청을 처리할 수 없습니다." }); }
export async function getAISettings(): Promise<AISettingsStatus> { return invokeAuthenticatedFunction("admin-ai-settings", { body: { action: "get" }, fallbackMessage: "AI 설정을 불러올 수 없습니다." }); }
export async function saveAIProvider(input: { provider: AIProvider; enabled: boolean; apiKey?: string }): Promise<AISettingsStatus> { return invokeAuthenticatedFunction("admin-ai-settings", { body: { action: "save_provider", ...input }, fallbackMessage: "AI provider 설정을 저장할 수 없습니다." }); }
export async function deleteAIKey(provider: AIProvider = "openai"): Promise<AISettingsStatus> { return invokeAuthenticatedFunction("admin-ai-settings", { body: { action: "delete_key", provider }, fallbackMessage: "AI API Key를 삭제할 수 없습니다." }); }
export async function testAIConnection(provider: AIProvider = "openai"): Promise<void> { await invokeAuthenticatedFunction("admin-ai-settings", { body: { action: "test", provider }, fallbackMessage: "AI 연결 테스트에 실패했습니다." }); }
export async function addAIModel(input: { provider: AIProvider; modelId: string; displayName: string; enabled?: boolean; isDefault?: boolean; sortOrder?: number }): Promise<AISettingsStatus> { return invokeAuthenticatedFunction("admin-ai-settings", { body: { action: "add_model", ...input }, fallbackMessage: "AI 모델을 추가할 수 없습니다." }); }
export async function updateAIModel(input: { provider: AIProvider; modelSettingId: string; modelId?: string; displayName?: string; enabled?: boolean; isDefault?: boolean; sortOrder?: number }): Promise<AISettingsStatus> { return invokeAuthenticatedFunction("admin-ai-settings", { body: { action: "update_model", ...input }, fallbackMessage: "AI 모델을 수정할 수 없습니다." }); }
export async function deleteAIModel(provider: AIProvider, modelSettingId: string): Promise<AISettingsStatus> { return invokeAuthenticatedFunction("admin-ai-settings", { body: { action: "delete_model", provider, modelSettingId }, fallbackMessage: "AI 모델을 삭제할 수 없습니다." }); }
