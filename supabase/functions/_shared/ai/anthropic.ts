import { ApiError } from "../http.ts";
import { rocketAIJsonSchema, validateRocketAIResult } from "./schema.ts";
import type { AIProviderRequest, AIProviderResponse } from "./provider.ts";

export async function callAnthropic(input: AIProviderRequest): Promise<AIProviderResponse> {
  let response: Response;
  try { response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal: input.signal, headers: { "x-api-key": input.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: input.model, max_tokens: 1800, system: `${input.system}\nReturn only JSON matching this schema: ${JSON.stringify(rocketAIJsonSchema)}`, messages: [{ role: "user", content: input.prompt }] }) }); }
  catch { if (input.signal?.aborted) throw new ApiError(504, "AI_TIMEOUT", "AI 응답 시간이 초과되었습니다."); throw new ApiError(502, "AI_PROVIDER_ERROR", "Anthropic에 연결할 수 없습니다."); }
  if (response.status === 401 || response.status === 403) throw new ApiError(502, "AI_AUTH_FAILED", "Anthropic API Key 인증에 실패했습니다.");
  if (response.status === 429) throw new ApiError(429, "AI_RATE_LIMIT", "AI 요청 한도에 도달했습니다.");
  if (!response.ok) throw new ApiError(502, "AI_PROVIDER_ERROR", "Anthropic 요청에 실패했습니다.");
  const payload = await response.json() as Record<string, unknown>;
  const text = Array.isArray(payload.content) ? payload.content.map((item) => item && typeof item === "object" ? (item as Record<string, unknown>).text : null).find((value): value is string => typeof value === "string") : undefined;
  if (!text) throw new ApiError(502, "AI_INVALID_RESPONSE", "Anthropic 응답 형식이 올바르지 않습니다.");
  let parsed: unknown; try { parsed = JSON.parse(text); } catch { throw new ApiError(502, "AI_INVALID_RESPONSE", "Anthropic 응답 형식이 올바르지 않습니다."); }
  const usage = payload.usage && typeof payload.usage === "object" ? payload.usage as Record<string, unknown> : {};
  return { result: validateRocketAIResult(parsed), inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : null, outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : null };
}
