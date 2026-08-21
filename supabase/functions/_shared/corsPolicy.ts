export type CorsHeaderRecord = Record<string, string>;

const PROJECT_HEADERS = ["x-idempotency-key"];

export function allowedOrigin(requestOrigin: string | null, configuredFrontendUrl: string): string | null {
  if (!requestOrigin) return null;
  try {
    // Browser Origin에는 path가 없으므로 GitHub Pages 전체 URL도 origin으로 정규화한다.
    return requestOrigin === new URL(configuredFrontendUrl).origin ? requestOrigin : null;
  } catch {
    return null;
  }
}

function mergedAllowedHeaders(sdkHeaders: CorsHeaderRecord): string {
  const headers = new Set(
    (sdkHeaders["Access-Control-Allow-Headers"] ?? "")
      .split(",")
      .map((header) => header.trim().toLowerCase())
      .filter(Boolean)
  );
  for (const header of PROJECT_HEADERS) headers.add(header);
  return [...headers].join(", ");
}

export function buildCorsHeaders(
  requestOrigin: string | null,
  configuredFrontendUrl: string,
  sdkHeaders: CorsHeaderRecord
): CorsHeaderRecord {
  const headers = { ...sdkHeaders };
  delete headers["Access-Control-Allow-Origin"];
  const origin = allowedOrigin(requestOrigin, configuredFrontendUrl);
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  headers["Access-Control-Allow-Headers"] = mergedAllowedHeaders(sdkHeaders);
  headers["Access-Control-Max-Age"] = "600";
  headers.Vary = "Origin";
  return headers;
}

export function createCorsPreflightResponse(
  request: Request,
  configuredFrontendUrl: string,
  sdkHeaders: CorsHeaderRecord
): Response {
  const headers = buildCorsHeaders(request.headers.get("Origin"), configuredFrontendUrl, sdkHeaders);
  if (!allowedOrigin(request.headers.get("Origin"), configuredFrontendUrl)) {
    return new Response(JSON.stringify({ error: "허용되지 않은 origin입니다.", code: "ORIGIN_DENIED" }), {
      status: 403,
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    });
  }
  return new Response(null, { status: 204, headers });
}
