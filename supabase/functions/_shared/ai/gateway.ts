import { ApiError } from "../http.ts";
import { validateRocketAIResult, type RocketAIResult } from "./schema.ts";

export interface AIGatewayRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  signal?: AbortSignal;
}
export interface AIGatewayResponse {
  result: RocketAIResult;
  inputTokens: number | null;
  outputTokens: number | null;
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  return host === "localhost" || host.endsWith(".localhost") || isPrivateIpv4(host)
    || host === "::" || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb");
}

export function normalizeGatewayBaseUrl(value: string, options: { allowLocal?: boolean; allowedHosts?: string[] } = {}): string {
  let url: URL;
  try { url = new URL(value.trim()); }
  catch { throw new ApiError(400, "AI_GATEWAY_URL_INVALID", "AI Gateway Base URL이 올바르지 않습니다."); }
  const localAllowed = options.allowLocal === true && url.protocol === "http:" && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !localAllowed) throw new ApiError(400, "AI_GATEWAY_HTTPS_REQUIRED", "운영 AI Gateway는 HTTPS URL이어야 합니다.");
  if (url.username || url.password || url.search || url.hash) throw new ApiError(400, "AI_GATEWAY_URL_INVALID", "AI Gateway Base URL이 올바르지 않습니다.");
  if (isPrivateHost(url.hostname) && !localAllowed) throw new ApiError(400, "AI_GATEWAY_PRIVATE_HOST_DENIED", "내부 네트워크 AI Gateway 주소는 사용할 수 없습니다.");
  const allowedHosts = options.allowedHosts?.map((host) => host.trim().toLowerCase()).filter(Boolean) ?? [];
  if (allowedHosts.length && !allowedHosts.includes(url.hostname.toLowerCase())) throw new ApiError(400, "AI_GATEWAY_HOST_DENIED", "허용되지 않은 AI Gateway host입니다.");
  return `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
}

export function gatewayUrlOptions(): { allowLocal: boolean; allowedHosts: string[] } {
  const localSupabase = Deno.env.get("SUPABASE_URL")?.startsWith("http://127.0.0.1") === true;
  return {
    allowLocal: !Deno.env.get("DENO_DEPLOYMENT_ID") && localSupabase,
    allowedHosts: (Deno.env.get("AI_GATEWAY_ALLOWED_HOSTS") ?? "").split(",")
  };
}

function completionEndpoint(baseUrl: string): string {
  return baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`;
}

export async function callAIGateway(input: AIGatewayRequest): Promise<AIGatewayResponse> {
  const baseUrl = normalizeGatewayBaseUrl(input.baseUrl, gatewayUrlOptions());
  let response: Response;
  try {
    response = await fetch(completionEndpoint(baseUrl), {
      method: "POST",
      signal: input.signal,
      headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: input.model,
        messages: [{ role: "system", content: input.system }, { role: "user", content: input.prompt }],
        response_format: { type: "json_object" },
        max_tokens: 1800
      })
    });
  } catch {
    if (input.signal?.aborted) throw new ApiError(504, "AI_TIMEOUT", "AI 응답 시간이 초과되었습니다.");
    throw new ApiError(502, "AI_GATEWAY_ERROR", "AI Gateway에 연결할 수 없습니다.");
  }
  if (response.status === 401 || response.status === 403) throw new ApiError(502, "AI_AUTH_FAILED", "AI Gateway 인증에 실패했습니다.");
  if (response.status === 429) throw new ApiError(429, "AI_RATE_LIMIT", "AI 요청 한도에 도달했습니다.");
  if (!response.ok) throw new ApiError(502, "AI_GATEWAY_ERROR", "AI Gateway 요청에 실패했습니다.");
  const payload = await response.json() as Record<string, unknown>;
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const message = choices[0] && typeof choices[0] === "object" ? (choices[0] as Record<string, unknown>).message : null;
  const content = message && typeof message === "object" ? (message as Record<string, unknown>).content : null;
  if (typeof content !== "string") throw new ApiError(502, "AI_INVALID_RESPONSE", "AI Gateway 응답 형식이 올바르지 않습니다.");
  let parsed: unknown;
  try { parsed = JSON.parse(content); }
  catch { throw new ApiError(502, "AI_INVALID_RESPONSE", "AI Gateway 응답 형식이 올바르지 않습니다."); }
  const usage = payload.usage && typeof payload.usage === "object" ? payload.usage as Record<string, unknown> : {};
  return {
    result: validateRocketAIResult(parsed),
    inputTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
    outputTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : null
  };
}
