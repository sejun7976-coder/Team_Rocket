import { corsHeaders as sdkCorsHeaders } from "@supabase/supabase-js/cors";
import { describe, expect, it } from "vitest";
import {
  allowedOrigin,
  buildCorsHeaders,
  createCorsPreflightResponse
} from "../../supabase/functions/_shared/corsPolicy";
import httpSource from "../../supabase/functions/_shared/http.ts?raw";
import authSource from "../../supabase/functions/_shared/auth.ts?raw";
import supabaseConfig from "../../supabase/config.toml?raw";

const GITHUB_ORIGIN = "https://sejun7976-coder.github.io";
const GITHUB_APP_URL = `${GITHUB_ORIGIN}/Team_Rocket`;
const ALLOWED_ORIGINS = [
  GITHUB_ORIGIN,
  "http://127.0.0.1:3000",
  "http://localhost:3000"
];
const DENIED_ORIGINS = [
  "http://127.0.0.1:3001",
  "http://localhost:5173",
  "https://malicious.example.com",
  "https://sejun7976-coder.github.io.malicious.example.com"
];
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

const selfAuthenticatedBrowserFunctions = {
  "admin-ai-logs": "requireSystemAdmin",
  "admin-ai-settings": "requireReadyUser",
  "admin-create-user": "requireReadyUser",
  "admin-delete-user": "requireReadyUser",
  "admin-list-access-logs": "requireReadyUser",
  "admin-list-projects": "requireReadyUser",
  "admin-list-users": "requireReadyUser",
  "admin-reset-password": "requireReadyUser",
  "admin-set-user-role": "requireReadyUser",
  "admin-set-user-permissions": "requireReadyUser",
  "admin-set-user-status": "requireReadyUser",
  "ai-chat": "requireReadyUser",
  "ai-models": "requireReadyUser",
  "complete-first-login": "requireUser",
  "create-project": "requireReadyUser",
  "delete-github-repository": "requireReadyUser",
  "delete-task": "requireReadyUser",
  "github-repository-status": "requireReadyUser",
  "github-retry": "requireReadyUser",
  "record-access-event": "requireUser",
  "remove-project-member": "requireReadyUser",
  "sync-project-member": "requireReadyUser"
} as const;

function configuredJwtBypasses(config: string): string[] {
  const matches = config.matchAll(
    /^\[functions\.([^\]]+)\]\s*\r?\nverify_jwt\s*=\s*false\s*$/gmu
  );
  return [...matches].map((match) => match[1] ?? "").filter(Boolean).sort();
}

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

  it.each(ALLOWED_ORIGINS)("allows only the configured production origin and fixed development origin %s", (origin) => {
    expect(allowedOrigin(origin, GITHUB_APP_URL)).toBe(origin);
    expect(buildCorsHeaders(origin, GITHUB_APP_URL, sdkCorsHeaders)["Access-Control-Allow-Origin"])
      .toBe(origin);
  });

  it.each(DENIED_ORIGINS)("rejects unconfigured origin %s", (origin) => {
    expect(allowedOrigin(origin, GITHUB_APP_URL)).toBeNull();
    expect(buildCorsHeaders(origin, GITHUB_APP_URL, sdkCorsHeaders))
      .not.toHaveProperty("Access-Control-Allow-Origin");
  });

  it.each(ALLOWED_ORIGINS)("returns 204 for an OPTIONS request from %s", (origin) => {
    const request = new Request("https://example.supabase.co/functions/v1/complete-first-login", {
      method: "OPTIONS",
      headers: { Origin: origin }
    });
    const response = createCorsPreflightResponse(request, GITHUB_APP_URL, sdkCorsHeaders);
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  });

  it.each(DENIED_ORIGINS)("returns 403 ORIGIN_DENIED for an OPTIONS request from %s", async (origin) => {
    const request = new Request("https://example.supabase.co/functions/v1/complete-first-login", {
      method: "OPTIONS",
      headers: { Origin: origin }
    });
    const response = createCorsPreflightResponse(request, GITHUB_APP_URL, sdkCorsHeaders);
    expect(response.status).toBe(403);
    expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
    await expect(response.json()).resolves.toMatchObject({ code: "ORIGIN_DENIED" });
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
      "admin-ai-logs",
      "admin-create-user",
      "admin-ai-settings",
      "admin-list-projects",
      "admin-list-users",
      "admin-reset-password",
      "admin-set-user-status",
      "admin-set-user-role",
      "admin-set-user-permissions",
      "bootstrap-system-admin",
      "complete-first-login",
      "create-project",
      "delete-github-repository",
      "github-retry",
      "remove-project-member",
      "sync-project-member",
      "record-access-event",
      "admin-list-access-logs",
      "delete-task",
      "admin-delete-user",
      "github-repository-status",
      "ai-chat",
      "ai-models",
    ];
    expect(Object.keys(edgeFunctionSources)).toHaveLength(expectedFunctions.length);
    for (const functionName of expectedFunctions) {
      const entry = Object.entries(edgeFunctionSources).find(([path]) => path.includes(`/${functionName}/index.ts`));
      expect(entry?.[1], `${functionName} must import the shared HTTP layer`).toContain("_shared/http.ts");
    }
  });

  it("disables Gateway JWT verification only for browser Functions with an internal auth guard", () => {
    expect(configuredJwtBypasses(supabaseConfig)).toEqual(
      Object.keys(selfAuthenticatedBrowserFunctions).sort()
    );
    expect(supabaseConfig).not.toContain("[functions.bootstrap-system-admin]");

    for (const [functionName, guard] of Object.entries(selfAuthenticatedBrowserFunctions)) {
      const entry = Object.entries(edgeFunctionSources).find(([path]) =>
        path.includes(`/${functionName}/index.ts`)
      );
      expect(entry?.[1], `${functionName} must authenticate POST inside the Function`)
        .toContain(`await ${guard}(request)`);
    }
  });

  it("keeps internal guards responsible for JWT, account readiness, and capability authorization", () => {
    expect(authSource).toContain("await caller.auth.getUser()");
    expect(authSource).toContain("canAccessManagedBusinessData");
    expect(authSource).toContain('from("user_admin_permissions")');
    expect(authSource).toContain('eq("permission", permission)');
    expect(httpSource).toContain('if (request.method === "OPTIONS")');
    expect(httpSource.indexOf('request.method === "OPTIONS"'))
      .toBeLessThan(httpSource.indexOf("return await handler(request)"));
  });
});
