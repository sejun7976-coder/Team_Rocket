export interface GatewayMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GatewayResult {
  output: unknown;
  inputTokens: number | null;
  outputTokens: number | null;
}

export class GatewayError extends Error {
  constructor(public readonly code: "CONFIG" | "TIMEOUT" | "REQUEST" | "RESPONSE") {
    super(code);
  }
}

export function gatewayEndpoint(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new GatewayError("CONFIG");
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.hash) {
    throw new GatewayError("CONFIG");
  }
  url.search = "";
  const path = url.pathname.replace(/\/+$/u, "");
  url.pathname = path.endsWith("/chat/completions") ? path : `${path}/chat/completions`;
  return url.toString();
}

function contentFromPayload(payload: Record<string, unknown>): string | null {
  if (typeof payload.output_text === "string") return payload.output_text;
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0];
  if (!first || typeof first !== "object") return null;
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

export async function callGateway(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: GatewayMessage[];
  timeoutMs?: number;
}): Promise<GatewayResult> {
  if (!input.apiKey.trim()) throw new GatewayError("CONFIG");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 30_000);
  try {
    const response = await fetch(gatewayEndpoint(input.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new GatewayError("REQUEST");
    const payload = await response.json() as Record<string, unknown>;
    const content = contentFromPayload(payload);
    if (!content || content.length > 100_000) throw new GatewayError("RESPONSE");
    let output: unknown;
    try {
      output = JSON.parse(content);
    } catch {
      throw new GatewayError("RESPONSE");
    }
    const usage = payload.usage && typeof payload.usage === "object"
      ? payload.usage as Record<string, unknown>
      : {};
    return {
      output,
      inputTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
      outputTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
    };
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw new GatewayError("TIMEOUT");
    throw new GatewayError("REQUEST");
  } finally {
    clearTimeout(timeout);
  }
}
