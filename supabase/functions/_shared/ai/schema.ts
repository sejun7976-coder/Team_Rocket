import { ApiError } from "../http.ts";

export const AI_INTENTS = ["chat", "create_task", "split_task", "project_briefing", "project_summary", "weekly_report", "project_qa", "github_summary"] as const;
export type AIIntent = typeof AI_INTENTS[number];

export interface RocketAIResult {
  intent: AIIntent;
  kind: "task_proposal" | "answer";
  summary: string;
  tasks: Array<{ title: string; description: string; priority: "low" | "medium" | "high" | "urgent"; dueDate: string | null; assigneeIds: string[] }>;
}

export const rocketAIJsonSchema = {
  type: "object", additionalProperties: false, required: ["intent", "kind", "summary", "tasks"],
  properties: {
    intent: { type: "string", enum: AI_INTENTS },
    kind: { type: "string", enum: ["task_proposal", "answer"] },
    summary: { type: "string", maxLength: 6000 },
    tasks: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["title", "description", "priority", "dueDate", "assigneeIds"], properties: { title: { type: "string", minLength: 1, maxLength: 240 }, description: { type: "string", maxLength: 6000 }, priority: { type: "string", enum: ["low", "medium", "high", "urgent"] }, dueDate: { type: ["string", "null"] }, assigneeIds: { type: "array", uniqueItems: true, maxItems: 50, items: { type: "string", format: "uuid" } } } } }
  }
} as const;

export function validateRocketAIResult(value: unknown): RocketAIResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(502, "AI_INVALID_RESPONSE", "AI 응답 형식이 올바르지 않습니다.");
  const result = value as Record<string, unknown>;
  if (!AI_INTENTS.includes(String(result.intent) as AIIntent) || !["task_proposal", "answer"].includes(String(result.kind)) || typeof result.summary !== "string" || !Array.isArray(result.tasks) || result.tasks.length > 20) throw new ApiError(502, "AI_INVALID_RESPONSE", "AI 응답 형식이 올바르지 않습니다.");
  for (const item of result.tasks) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new ApiError(502, "AI_INVALID_RESPONSE", "AI Task 제안이 올바르지 않습니다.");
    const task = item as Record<string, unknown>;
    if (typeof task.title !== "string" || !task.title.trim() || task.title.length > 240 || typeof task.description !== "string" || !["low", "medium", "high", "urgent"].includes(String(task.priority)) || (task.dueDate !== null && typeof task.dueDate !== "string") || !Array.isArray(task.assigneeIds) || task.assigneeIds.some((id) => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id))) throw new ApiError(502, "AI_INVALID_RESPONSE", "AI Task 제안이 올바르지 않습니다.");
  }
  return value as RocketAIResult;
}

export function detectIntent(message: string): AIIntent {
  const normalized = message.toLowerCase();
  if (/(github|git\s*hub|깃허브|깃헙|커밋|commit)/u.test(normalized)) return "github_summary";
  if (/(분해|쪼개|나눠|하위\s*작업|subtask)/u.test(normalized)) return "split_task";
  if (/(주간|이번\s*주|weekly)/u.test(normalized) && /(보고|정리|report)/u.test(normalized)) return "weekly_report";
  if (/(맡겨|할당|담당|task\s*(?:생성|추가)|작업\s*(?:생성|추가|만들))/u.test(normalized)) return "create_task";
  if (/(오늘|뭐부터|우선순위|briefing)/u.test(normalized)) return "project_briefing";
  if (/(프로젝트|진행|상황).*(요약|정리|summary)/u.test(normalized)) return "project_summary";
  if (/(프로젝트|작업|일정).*(질문|알려|어때|무엇|언제|누가)/u.test(normalized)) return "project_qa";
  return "chat";
}
