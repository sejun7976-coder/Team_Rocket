import { invokeAuthenticatedFunction } from "../lib/authenticatedFunction";
import type { AccountStatus, SystemRole } from "../types/domain";

export type AdminUserStatus = "initial_login_pending" | "password_change_required" | "active" | "inactive";

export interface AdminUser {
  id: string;
  student_id: string;
  name: string;
  github_username: string | null;
  system_role: SystemRole;
  account_status: AccountStatus;
  status: AdminUserStatus;
  created_at: string;
  first_login_completed_at: string | null;
  password_changed_at: string | null;
  key_reset_at: string | null;
  lastSignInAt: string | null;
}

export interface AdminProject {
  id: string;
  name: string;
  status: string;
  visibility: string;
  github_repository_name: string;
  github_repository_url: string | null;
  github_sync_status: string;
  created_at: string;
  updated_at: string;
  creator: { name: string; student_id: string } | null;
  project_members: Array<{ count: number }>;
  tasks: Array<{ count: number }>;
}

async function invokeAdmin<T>(functionName: string, body: Record<string, unknown> = {}): Promise<T> {
  return invokeAuthenticatedFunction<T>(functionName, {
    body,
    fallbackMessage: "관리자 요청을 처리할 수 없습니다."
  });
}

export async function listAdminUsers(): Promise<AdminUser[]> {
  const data = await invokeAdmin<{ users: AdminUser[] }>("admin-list-users");
  return data.users;
}

export async function createAdminUser(input: { studentId: string; name: string; githubUsername?: string }): Promise<{ user: AdminUser; initialPassword: "1234" }> {
  return invokeAdmin("admin-create-user", input);
}

export async function resetAdminUserPassword(userId: string): Promise<{ initialPassword: "1234"; projectKeyRewrapRequired: boolean }> {
  return invokeAdmin("admin-reset-password", { userId });
}

export async function setAdminUserActive(userId: string, active: boolean): Promise<void> {
  await invokeAdmin("admin-set-user-status", { userId, active });
}

export async function listAdminProjects(): Promise<AdminProject[]> {
  const data = await invokeAdmin<{ projects: AdminProject[] }>("admin-list-projects");
  return data.projects;
}
