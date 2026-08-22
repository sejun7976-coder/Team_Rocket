import type { FunctionInvokeOptions, Session } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import adminSource from "../services/admin.ts?raw";
import projectsSource from "../services/projects.ts?raw";
import authStoreSource from "../stores/authStore.ts?raw";
import accessLogSource from "../services/accessLogs.ts?raw";
import helperSource from "./authenticatedFunction.ts?raw";
import {
  AuthenticatedFunctionError,
  createAuthenticatedFunctionInvoker,
  type AuthenticatedFunctionClient
} from "./authenticatedFunction";

const NOW = 1_800_000_000_000;

function session(accessToken: string, expiresAt = Math.floor(NOW / 1000) + 3_600): Session {
  return {
    access_token: accessToken,
    refresh_token: "refresh-token-not-logged",
    expires_in: 3_600,
    expires_at: expiresAt,
    token_type: "bearer",
    user: { id: "00000000-0000-4000-8000-000000000001" }
  } as Session;
}

function clientWith(options: {
  currentSession: Session | null;
  refreshedSession?: Session | null;
  invoke?: (functionName: string, invokeOptions: FunctionInvokeOptions) => Promise<{
    data: unknown | null;
    error: unknown;
    response?: Response;
  }>;
}) {
  const invoke = vi.fn(options.invoke ?? (async () => ({ data: { ok: true }, error: null })));
  const getSession = vi.fn(async () => ({ data: { session: options.currentSession }, error: null }));
  const refreshSession = vi.fn(async () => ({
    data: { session: options.refreshedSession ?? null },
    error: options.refreshedSession ? null : new Error("refresh failed")
  }));
  return {
    client: { auth: { getSession, refreshSession }, functions: { invoke } } as unknown as AuthenticatedFunctionClient,
    getSession,
    refreshSession,
    invoke
  };
}

describe("authenticated Edge Function invocation", () => {
  it("passes the current session access token as an explicit Authorization Bearer header", async () => {
    const fixture = clientWith({ currentSession: session("session-access-token") });
    const invoke = createAuthenticatedFunctionInvoker(fixture.client, () => NOW);
    await expect(invoke<{ ok: boolean }>("admin-list-users", { body: {} })).resolves.toEqual({ ok: true });
    expect(fixture.invoke).toHaveBeenCalledTimes(1);
    expect(fixture.invoke.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer session-access-token"
    });
  });

  it("does not send a Function request when no Auth session exists", async () => {
    const fixture = clientWith({ currentSession: null });
    const invoke = createAuthenticatedFunctionInvoker(fixture.client, () => NOW);
    await expect(invoke("complete-first-login")).rejects.toMatchObject({ code: "AUTH_SESSION_REQUIRED" });
    expect(fixture.refreshSession).not.toHaveBeenCalled();
    expect(fixture.invoke).not.toHaveBeenCalled();
  });

  it("refreshes an expired session once and uses only the new access token", async () => {
    const fixture = clientWith({
      currentSession: session("expired-access-token", Math.floor(NOW / 1000) - 1),
      refreshedSession: session("refreshed-access-token")
    });
    const invoke = createAuthenticatedFunctionInvoker(fixture.client, () => NOW);
    await invoke("admin-list-projects");
    expect(fixture.refreshSession).toHaveBeenCalledTimes(1);
    expect(fixture.invoke).toHaveBeenCalledTimes(1);
    expect(fixture.invoke.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer refreshed-access-token"
    });
  });

  it("refreshes once and retries when the Gateway rejects an apparently valid token", async () => {
    const unauthorized = new Response(JSON.stringify({ code: "UNAUTHORIZED_NO_AUTH_HEADER" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
    let calls = 0;
    const fixture = clientWith({
      currentSession: session("stale-access-token"),
      refreshedSession: session("gateway-retry-token"),
      invoke: async () => {
        calls += 1;
        return calls === 1
          ? { data: null, error: { context: unauthorized }, response: unauthorized }
          : { data: { completed: true }, error: null };
      }
    });
    const invoke = createAuthenticatedFunctionInvoker(fixture.client, () => NOW);
    await expect(invoke("complete-first-login")).resolves.toEqual({ completed: true });
    expect(fixture.refreshSession).toHaveBeenCalledTimes(1);
    expect(fixture.invoke).toHaveBeenCalledTimes(2);
    expect(fixture.invoke.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer gateway-retry-token"
    });
  });

  it("never emits access tokens through logs or client error messages", async () => {
    const token = "raw-jwt-must-never-be-visible";
    const response = new Response(JSON.stringify({ code: "SAFE_FAILURE", message: token }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
    const fixture = clientWith({
      currentSession: session(token),
      invoke: async () => ({ data: null, error: { context: response }, response })
    });
    const spies = ["log", "info", "warn", "error"].map((method) =>
      vi.spyOn(console, method as "log").mockImplementation(() => undefined)
    );
    const invoke = createAuthenticatedFunctionInvoker(fixture.client, () => NOW);
    let caught: unknown;
    try {
      await invoke("admin-list-users", { fallbackMessage: "관리자 요청 실패" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AuthenticatedFunctionError);
    expect((caught as Error).message).toBe("관리자 요청 실패");
    expect(JSON.stringify(caught)).not.toContain(token);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    for (const spy of spies) spy.mockRestore();
    expect(helperSource).not.toMatch(/console\.(?:log|info|warn|error)/u);
  });

  it("shows a bounded public server message without exposing internal codes", async () => {
    const response = new Response(JSON.stringify({
      code: "REPOSITORY_NAME_CONFLICT",
      error: "같은 이름의 GitHub 저장소가 이미 있습니다.",
    }), { status: 409, headers: { "Content-Type": "application/json" } });
    const fixture = clientWith({
      currentSession: session("safe-session-token"),
      invoke: async () => ({ data: null, error: { context: response }, response }),
    });
    const invoke = createAuthenticatedFunctionInvoker(fixture.client, () => NOW);
    await expect(invoke("create-project", { fallbackMessage: "프로젝트를 만들 수 없습니다." }))
      .rejects.toMatchObject({
        code: "REPOSITORY_NAME_CONFLICT",
        message: "같은 이름의 GitHub 저장소가 이미 있습니다.",
      });
  });

  it("supports the complete-first-login recovery payload through the common helper", async () => {
    const fixture = clientWith({
      currentSession: session("recovery-session-token"),
      invoke: async (functionName, options) => ({
        data: {
          completed: functionName === "complete-first-login",
          receivedBody: options.body
        },
        error: null
      })
    });
    const invoke = createAuthenticatedFunctionInvoker(fixture.client, () => NOW);
    const result = await invoke<{ completed: boolean }>("complete-first-login", {
      body: { derivedCredential: "derived", keyring: { encrypted: true } }
    });
    expect(result.completed).toBe(true);
    expect(fixture.invoke.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer recovery-session-token"
    });
  });

  it("routes every protected application Function through the same helper", () => {
    const applicationSources = `${adminSource}\n${projectsSource}\n${authStoreSource}\n${accessLogSource}`;
    for (const functionName of [
      "admin-create-user",
      "admin-list-users",
      "admin-reset-password",
      "admin-set-user-status",
      "admin-list-projects",
      "create-project",
      "sync-project-member",
      "remove-project-member",
      "github-retry",
      "delete-github-repository",
      "complete-first-login",
      "record-access-event",
      "admin-list-access-logs"
    ]) {
      expect(applicationSources).toContain(`"${functionName}"`);
    }
    expect(applicationSources).toContain("invokeAuthenticatedFunction");
    expect(applicationSources).not.toContain("supabase.functions.invoke");
  });
});
