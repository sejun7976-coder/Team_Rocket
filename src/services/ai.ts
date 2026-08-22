import { invokeAuthenticatedFunction } from "../lib/authenticatedFunction";
import type { TaskPriority } from "../types/domain";

export type AIFeature = "create_task" | "decompose_tasks" | "briefing" | "project_summary" | "weekly_report" | "project_qa" | "github_summary";
export interface AITaskProposal { title: string; description: string; priority: TaskPriority; dueDate: string | null; assigneeIds: string[] }
export interface RocketAIResponse { kind: "task_proposal" | "answer"; summary: string; tasks: AITaskProposal[] }
export interface AISettingsStatus { enabled: boolean; provider: "openai"; model: string; configured: boolean; updatedAt: string | null }

export async function requestRocketAI(input: { projectId: string; feature: AIFeature; prompt: string; context: Record<string, unknown> }): Promise<RocketAIResponse> {
  return invokeAuthenticatedFunction("ai-assistant", { body: input, fallbackMessage: "Rocket AI 요청을 처리할 수 없습니다." });
}
export async function getAISettings(): Promise<AISettingsStatus> { return invokeAuthenticatedFunction("admin-ai-settings", { body: { action: "get" }, fallbackMessage: "AI 설정을 불러올 수 없습니다." }); }
export async function saveAISettings(input: { enabled: boolean; provider: "openai"; model: string; apiKey?: string }): Promise<AISettingsStatus> { return invokeAuthenticatedFunction("admin-ai-settings", { body: { action: "save", ...input }, fallbackMessage: "AI 설정을 저장할 수 없습니다." }); }
export async function deleteAIKey(): Promise<AISettingsStatus> { return invokeAuthenticatedFunction("admin-ai-settings", { body: { action: "delete_key" }, fallbackMessage: "AI API Key를 삭제할 수 없습니다." }); }
export async function testAIConnection(): Promise<void> { await invokeAuthenticatedFunction("admin-ai-settings", { body: { action: "test" }, fallbackMessage: "AI 연결 테스트에 실패했습니다." }); }
