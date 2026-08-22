import { corsHeaders as sdkCorsHeaders } from "@supabase/supabase-js/cors";
import { describe, expect, it } from "vitest";
import {
  allowedOrigin,
  buildCorsHeaders,
  createCorsPreflightResponse
} from "../../supabase/functions/_shared/corsPolicy";
import httpSource from "../../supabase/functions/_shared/http.ts?raw";

const GITHUB_ORIGIN = "https://sejun7976-coder.github.io";
const GITHUB_APP_URL = `${GITHUB_ORIGIN}/Team_Rocket`;
const REQUIRED_HEADERS = [
  "authorization",
  "x-client-info",
  "apikey",
  "content-type",
  "x-retry-count",
  "traceparent",
  "tracestate",
  "baggage",
  "x-idempotency-key"
];

const edgeFunctionSources = import.meta.glob("../../supabase/functions/*/index.ts", {
  query: "?raw",
  import: "default",
  eager: true
}) as Record<string, string>;

describe("Edge Function CORS policy", () => {
  it("returns 204 when the Supabase client requests x-client-info in preflight", () => {
    const request = new Request("https://example.supabase.co/functions/v1/complete-first-login", {
      method: "OPTIONS",
      headers: {
        Origin: GITHUB_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "apikey,authorization,content-type,x-client-info"
      }
    });
    const response = createCorsPreflightResponse(request, GITHUB_APP_URL, sdkCorsHeaders);
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("x-client-info");
  });

  it("allows every header used by Supabase JS 2.112.3 plus the project idempotency header", () => {
    const headers = buildCorsHeaders(GITHUB_ORIGIN, GITHUB_APP_URL, sdkCorsHeaders);
    const allowed = (headers["Access-Control-Allow-Headers"] ?? "")
      .split(",")
      .map((header) => header.trim().toLowerCase());
    for (const required of REQUIRED_HEADERS) expect(allowed).toContain(required);
  });

  it("keeps the exact GitHub Pages origin instead of the SDK wildcard", () => {
    const headers = buildCorsHeaders(GITHUB_ORIGIN, GITHUB_APP_URL, sdkCorsHeaders);
    expect(allowedOrigin(GITHUB_ORIGIN, GITHUB_APP_URL)).toBe(GITHUB_ORIGIN);
    expect(headers["Access-Control-Allow-Origin"]).toBe(GITHUB_ORIGIN);
    expect(headers["Access-Control-Allow-Origin"]).not.toBe("*");
  });

  it("rejects a different origin without returning an allow-origin header", async () => {
    const request = new Request("https://example.supabase.co/functions/v1/complete-first-login", {
      method: "OPTIONS",
      headers: { Origin: "https://attacker.example" }
    });
    const response = createCorsPreflightResponse(request, GITHUB_APP_URL, sdkCorsHeaders);
    expect(response.status).toBe(403);
    expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
    await expect(response.json()).resolves.toMatchObject({ code: "ORIGIN_DENIED" });
  });

  it("derives SDK headers and methods from the official cors export", () => {
    expect(httpSource).toContain('from "npm:@supabase/supabase-js@2.112.3/cors"');
    expect(httpSource).toContain("buildCorsHeaders");
    expect(httpSource).not.toContain('"authorization, apikey, content-type, x-idempotency-key"');
  });

  it("applies the shared HTTP/CORS layer to every Edge Function bundle", () => {
    const expectedFunctions = [
      "admin-create-user",
      "admin-list-projects",
      "admin-list-users",
      "admin-reset-password",
      "admin-set-user-status",
      "bootstrap-system-admin",
      "complete-first-login",
      "create-project",
      "delete-github-repository",
      "github-retry",
      "remove-project-member",
      "sync-project-member",
      "record-access-event",
      "admin-list-access-logs",
      "ai-assistant",
      "admin-ai-settings",
      "delete-task"
    ];
    expect(Object.keys(edgeFunctionSources)).toHaveLength(expectedFunctions.length);
    for (const functionName of expectedFunctions) {
      const entry = Object.entries(edgeFunctionSources).find(([path]) => path.includes(`/${functionName}/index.ts`));
      expect(entry?.[1], `${functionName} must import the shared HTTP layer`).toContain("_shared/http.ts");
    }
  });
});
