import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";
import { ApiError } from "./http.ts";
import { canAccessManagedBusinessData, canActAsSystemAdmin } from "./accountPolicy.ts";

export interface AuthContext {
  user: User;
  admin: SupabaseClient;
}

interface ManagedProfile {
  system_role: "user" | "admin";
  account_status: "password_change_required" | "active" | "inactive";
}

export async function requireUser(request: Request): Promise<AuthContext> {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) throw new ApiError(401, "AUTH_REQUIRED", "로그인이 필요합니다.");
  const url = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !publishableKey || !serviceRoleKey) throw new Error("Supabase function secrets are incomplete");

  const caller = createClient(url, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await caller.auth.getUser();
  if (error || !data.user) throw new ApiError(401, "INVALID_JWT", "로그인 세션이 유효하지 않습니다.");

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return { user: data.user, admin };
}

async function managedProfile(context: AuthContext): Promise<ManagedProfile> {
  const { data, error } = await context.admin
    .from("profiles")
    .select("system_role, account_status")
    .eq("id", context.user.id)
    .single();
  if (error || !data) throw new ApiError(403, "PROFILE_REQUIRED", "사용자 프로필을 확인할 수 없습니다.");
  return data as ManagedProfile;
}

export async function requireReadyUser(request: Request): Promise<AuthContext> {
  const context = await requireUser(request);
  const profile = await managedProfile(context);
  if (profile.account_status === "inactive" || context.user.app_metadata.account_active === false) {
    throw new ApiError(403, "ACCOUNT_INACTIVE", "비활성화된 계정입니다.");
  }
  if (!canAccessManagedBusinessData(profile.account_status, context.user.app_metadata)) {
    throw new ApiError(403, "PASSWORD_CHANGE_REQUIRED", "비밀번호를 먼저 변경해야 합니다.");
  }
  return context;
}

export async function requireSystemAdmin(request: Request): Promise<AuthContext> {
  const context = await requireUser(request);
  const profile = await managedProfile(context);
  if (!canActAsSystemAdmin(profile.system_role, profile.account_status, context.user.app_metadata)) {
    throw new ApiError(403, "SYSTEM_ADMIN_REQUIRED", "시스템 관리자 권한이 필요합니다.");
  }
  return context;
}
