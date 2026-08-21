export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function allowedOrigin(request: Request): string | null {
  const origin = request.headers.get("Origin");
  const configured = Deno.env.get("FRONTEND_URL") ?? "http://127.0.0.1:3000";
  try {
    // Browser Origin에는 path가 없다. GitHub Pages의 전체 app URL이 Secret에
    // 등록되어도 scheme/host/port만 비교해 정확한 단일 origin만 허용한다.
    return origin === new URL(configured).origin ? origin : null;
  } catch {
    return null;
  }
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = allowedOrigin(request);
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-idempotency-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin"
  };
}

export function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

export async function readJson<T>(request: Request, maxBytes = 32_768): Promise<T> {
  if (request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new ApiError(415, "CONTENT_TYPE_REQUIRED", "JSON 요청만 허용됩니다.");
  }
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > maxBytes) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "요청이 너무 큽니다.");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "요청이 너무 큽니다.");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "JSON 요청을 읽을 수 없습니다.");
  }
}

export function serve(handler: (request: Request) => Promise<Response>): void {
  Deno.serve(async (request) => {
    if (request.method === "OPTIONS") {
      if (!allowedOrigin(request)) return json(request, { error: "허용되지 않은 origin입니다.", code: "ORIGIN_DENIED" }, 403);
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (request.method !== "POST") return json(request, { error: "허용되지 않은 method입니다.", code: "METHOD_NOT_ALLOWED" }, 405);
    if (request.headers.has("Origin") && !allowedOrigin(request)) {
      return json(request, { error: "허용되지 않은 origin입니다.", code: "ORIGIN_DENIED" }, 403);
    }
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof ApiError) return json(request, { error: error.message, code: error.code }, error.status);
      console.error(JSON.stringify({ event: "edge_function_error", code: "INTERNAL_ERROR" }));
      return json(request, { error: "요청을 처리할 수 없습니다.", code: "INTERNAL_ERROR" }, 500);
    }
  });
}
