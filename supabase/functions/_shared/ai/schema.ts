import { ApiError } from "../http.ts";

export const AI_FEATURES = ["create_task", "decompose_tasks", "briefing", "project_summary", "weekly_report", "project_qa", "github_summary"] as const;
export type AIFeature = typeof AI_FEATURES[number];

export interface RocketAIResult {
  kind: "task_proposal" | "answer";
  summary: string;
  tasks: Array<{ title: string; description: string; priority: "low" | "medium" | "high" | "urgent"; dueDate: string | null; assigneeIds: string[] }>;
}

export const rocketAIJsonSchema = {
  type: "object", additionalProperties: false, required: ["kind", "summary", "tasks"],
  properties: {
    kind: { type: "string", enum: ["task_proposal", "answer"] },
    summary: { type: "string", maxLength: 6000 },
    tasks: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["title", "description", "priority", "dueDate", "assigneeIds"], properties: { title: { type: "string", minLength: 1, maxLength: 240 }, description: { type: "string", maxLength: 6000 }, priority: { type: "string", enum: ["low", "medium", "high", "urgent"] }, dueDate: { type: ["string", "null"] }, assigneeIds: { type: "array", uniqueItems: true, maxItems: 50, items: { type: "string", format: "uuid" } } } } }
  }
} as const;

export function validateRocketAIResult(value: unknown): RocketAIResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(502, "AI_INVALID_RESPONSE", "AI 응답 형식이 올바르지 않습니다.");
  const result = value as Record<string, unknown>;
  if (!["task_proposal", "answer"].includes(String(result.kind)) || typeof result.summary !== "string" || !Array.isArray(result.tasks) || result.tasks.length > 20) throw new ApiError(502, "AI_INVALID_RESPONSE", "AI 응답 형식이 올바르지 않습니다.");
  for (const item of result.tasks) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new ApiError(502, "AI_INVALID_RESPONSE", "AI Task 제안이 올바르지 않습니다.");
    const task = item as Record<string, unknown>;
    if (typeof task.title !== "string" || !task.title.trim() || task.title.length > 240 || typeof task.description !== "string" || !["low", "medium", "high", "urgent"].includes(String(task.priority)) || (task.dueDate !== null && typeof task.dueDate !== "string") || !Array.isArray(task.assigneeIds) || task.assigneeIds.some((id) => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id))) throw new ApiError(502, "AI_INVALID_RESPONSE", "AI Task 제안이 올바르지 않습니다.");
  }
  return value as RocketAIResult;
}
