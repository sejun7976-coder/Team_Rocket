import { ApiError } from "../http.ts";
import { rocketAIJsonSchema, validateRocketAIResult } from "./schema.ts";
import type { AIProviderRequest, AIProviderResponse } from "./provider.ts";

export async function callGoogle(input: AIProviderRequest): Promise<AIProviderResponse> {
  let response: Response;
  try { response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`, { method: "POST", signal: input.signal, headers: { "Content-Type": "application/json", "x-goog-api-key": input.apiKey }, body: JSON.stringify({ systemInstruction: { parts: [{ text: input.system }] }, contents: [{ role: "user", parts: [{ text: input.prompt }] }], generationConfig: { maxOutputTokens: 1800, responseMimeType: "application/json", responseJsonSchema: rocketAIJsonSchema } }) }); }
  catch { if (input.signal?.aborted) throw new ApiError(504, "AI_TIMEOUT", "AI 응답 시간이 초과되었습니다."); throw new ApiError(502, "AI_PROVIDER_ERROR", "Google AI에 연결할 수 없습니다."); }
  if (response.status === 400 || response.status === 401 || response.status === 403) throw new ApiError(502, "AI_AUTH_FAILED", "Google AI API Key 또는 모델 설정을 확인해 주세요.");
  if (response.status === 429) throw new ApiError(429, "AI_RATE_LIMIT", "AI 요청 한도에 도달했습니다.");
  if (!response.ok) throw new ApiError(502, "AI_PROVIDER_ERROR", "Google AI 요청에 실패했습니다.");
  const payload = await response.json() as Record<string, unknown>;
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const content = candidates[0] && typeof candidates[0] === "object" ? (candidates[0] as Record<string, unknown>).content : null;
  const parts = content && typeof content === "object" && Array.isArray((content as Record<string, unknown>).parts) ? (content as { parts: unknown[] }).parts : [];
  const text = parts.map((part) => part && typeof part === "object" ? (part as Record<string, unknown>).text : null).find((value): value is string => typeof value === "string");
  if (!text) throw new ApiError(502, "AI_INVALID_RESPONSE", "Google AI 응답 형식이 올바르지 않습니다.");
  let parsed: unknown; try { parsed = JSON.parse(text); } catch { throw new ApiError(502, "AI_INVALID_RESPONSE", "Google AI 응답 형식이 올바르지 않습니다."); }
  const usage = payload.usageMetadata && typeof payload.usageMetadata === "object" ? payload.usageMetadata as Record<string, unknown> : {};
  return { result: validateRocketAIResult(parsed), inputTokens: typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : null, outputTokens: typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount : null };
}
