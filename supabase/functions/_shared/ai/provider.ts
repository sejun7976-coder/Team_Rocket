import { ApiError } from "../http.ts";
import { rocketAIJsonSchema, validateRocketAIResult, type RocketAIResult } from "./schema.ts";

export async function callOpenAI(input: { apiKey: string; model: string; prompt: string; signal?: AbortSignal }): Promise<{ result: RocketAIResult; inputTokens: number | null; outputTokens: number | null }> {
  let response: Response;
  try { response = await fetch("https://api.openai.com/v1/responses", { method: "POST", signal: input.signal, headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: input.model, store: false, max_output_tokens: 1800, instructions: "You are Rocket AI, a project-management assistant. Never claim that you changed data. For task features return proposals only. Use only supplied context and member UUIDs. Answer in Korean.", input: input.prompt, text: { format: { type: "json_schema", name: "rocket_ai_response", strict: true, schema: rocketAIJsonSchema } } }) }); }
  catch { if (input.signal?.aborted) throw new ApiError(504, "AI_TIMEOUT", "AI 응답 시간이 초과되었습니다."); throw new ApiError(502, "AI_PROVIDER_ERROR", "AI provider에 연결할 수 없습니다."); }
  if (response.status === 401 || response.status === 403) throw new ApiError(502, "AI_AUTH_FAILED", "AI API Key 인증에 실패했습니다.");
  if (response.status === 429) throw new ApiError(429, "AI_RATE_LIMIT", "AI 요청 한도에 도달했습니다.");
  if (!response.ok) throw new ApiError(502, "AI_PROVIDER_ERROR", "AI provider 요청에 실패했습니다.");
  let payload: Record<string, unknown>; try { payload = await response.json() as Record<string, unknown>; } catch { throw new ApiError(502, "AI_INVALID_RESPONSE", "AI 응답을 읽을 수 없습니다."); }
  const outputText = typeof payload.output_text === "string" ? payload.output_text : Array.isArray(payload.output)
    ? payload.output.flatMap((item) => item && typeof item === "object" && Array.isArray((item as Record<string, unknown>).content) ? (item as { content: unknown[] }).content : []).map((content) => content && typeof content === "object" ? (content as Record<string, unknown>).text : null).find((text): text is string => typeof text === "string")
    : undefined;
  if (!outputText) throw new ApiError(502, "AI_INVALID_RESPONSE", "AI 응답 형식이 올바르지 않습니다.");
  let parsed: unknown; try { parsed = JSON.parse(outputText); } catch { throw new ApiError(502, "AI_INVALID_RESPONSE", "AI 응답 형식이 올바르지 않습니다."); }
  const usage = payload.usage && typeof payload.usage === "object" ? payload.usage as Record<string, unknown> : {};
  return { result: validateRocketAIResult(parsed), inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : null, outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : null };
}
