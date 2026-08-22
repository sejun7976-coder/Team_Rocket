import type { FunctionInvokeOptions, Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

const TOKEN_EXPIRY_SKEW_SECONDS = 30;

interface FunctionResponse<T> {
  data: T | null;
  error: unknown;
  response?: Response;
}

export interface AuthenticatedFunctionClient {
  auth: {
    getSession: () => Promise<{ data: { session: Session | null }; error: unknown }>;
    refreshSession: () => Promise<{ data: { session: Session | null }; error: unknown }>;
  };
  functions: {
    invoke: <T>(functionName: string, options: FunctionInvokeOptions) => Promise<FunctionResponse<T>>;
  };
}

export interface AuthenticatedFunctionOptions extends FunctionInvokeOptions {
  fallbackMessage?: string;
}

export class AuthenticatedFunctionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "AuthenticatedFunctionError";
  }
}

function hasUsableAccessToken(session: Session | null): session is Session {
  return Boolean(session?.access_token?.trim());
}

function tokenNeedsRefresh(session: Session, nowMilliseconds: number): boolean {
  return typeof session.expires_at !== "number"
    || session.expires_at <= Math.floor(nowMilliseconds / 1000) + TOKEN_EXPIRY_SKEW_SECONDS;
}

function responseFromError(error: unknown, response?: Response): Response | undefined {
  if (response) return response;
  if (typeof error !== "object" || error === null || !("context" in error)) return undefined;
  return (error as { context?: unknown }).context instanceof Response
    ? (error as { context: Response }).context
    : undefined;
}

function safeCode(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{1,63}$/u.test(value) ? value : null;
}

function safePublicMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const message = value.trim();
  const hasControlCharacter = [...message].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
  if (!message || message.length > 240 || !/[가-힣]/u.test(message) || hasControlCharacter) return null;
  if (/(?:bearer\s+|eyJ[a-zA-Z0-9_-]{10,}|service[_ -]?role|api[_ -]?key)/iu.test(message)) return null;
  return message;
}

async function functionError(
  error: unknown,
  response: Response | undefined,
  fallbackMessage: string
): Promise<AuthenticatedFunctionError> {
  const errorResponse = responseFromError(error, response);
  let code = errorResponse?.status === 401 ? "EDGE_FUNCTION_UNAUTHORIZED" : "EDGE_FUNCTION_REQUEST_FAILED";
  let message = fallbackMessage;
  if (errorResponse) {
    try {
      const payload = await errorResponse.clone().json() as { code?: unknown; error?: unknown };
      code = safeCode(payload.code) ?? code;
      message = safePublicMessage(payload.error) ?? message;
    } catch {
      // 오류 body 원문은 UI나 로그로 전달하지 않는다.
    }
  }
  return new AuthenticatedFunctionError(code, message, errorResponse?.status);
}

function authorizationHeaders(headers: FunctionInvokeOptions["headers"], accessToken: string): Record<string, string> {
  const sanitized = Object.fromEntries(
    Object.entries(headers ?? {}).filter(([name]) => name.toLowerCase() !== "authorization")
  );
  return { ...sanitized, Authorization: `Bearer ${accessToken}` };
}

export function createAuthenticatedFunctionInvoker(
  client: AuthenticatedFunctionClient,
  now: () => number = Date.now
) {
  return async function invokeAuthenticatedFunction<T>(
    functionName: string,
    options: AuthenticatedFunctionOptions = {}
  ): Promise<T> {
    const { fallbackMessage = "보호된 서버 요청을 처리할 수 없습니다.", ...invokeOptions } = options;
    const initial = await client.auth.getSession();
    if (!initial.data.session) {
      throw new AuthenticatedFunctionError("AUTH_SESSION_REQUIRED", "로그인 세션이 없습니다. 다시 로그인해 주세요.");
    }

    let session = initial.data.session;
    let refreshed = false;
    const refreshOnce = async (): Promise<Session> => {
      if (refreshed) {
        throw new AuthenticatedFunctionError("AUTH_SESSION_REFRESH_FAILED", "로그인 세션을 갱신할 수 없습니다. 다시 로그인해 주세요.");
      }
      refreshed = true;
      const result = await client.auth.refreshSession();
      if (result.error || !hasUsableAccessToken(result.data.session)) {
        throw new AuthenticatedFunctionError("AUTH_SESSION_REFRESH_FAILED", "로그인 세션을 갱신할 수 없습니다. 다시 로그인해 주세요.");
      }
      return result.data.session;
    };

    if (initial.error || !hasUsableAccessToken(session) || tokenNeedsRefresh(session, now())) {
      session = await refreshOnce();
    }

    const call = (currentSession: Session) => client.functions.invoke<T>(functionName, {
      ...invokeOptions,
      headers: authorizationHeaders(invokeOptions.headers, currentSession.access_token)
    });

    let result = await call(session);
    const firstResponse = responseFromError(result.error, result.response);
    if (result.error && firstResponse?.status === 401 && !refreshed) {
      session = await refreshOnce();
      result = await call(session);
    }
    if (result.error || result.data === null) {
      throw await functionError(result.error, result.response, fallbackMessage);
    }
    return result.data;
  };
}

export const invokeAuthenticatedFunction = createAuthenticatedFunctionInvoker(
  supabase as unknown as AuthenticatedFunctionClient
);
