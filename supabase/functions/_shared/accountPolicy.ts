export const INITIAL_PASSWORD = "1234" as const;
export const STUDENT_ID_PATTERN = /^[0-9]{6,12}$/u;

export type ManagedAccountStatus = "password_change_required" | "active" | "inactive";

export interface ManagedAppMetadata {
  must_change_password?: unknown;
  system_role?: unknown;
  account_active?: unknown;
}

export function studentIdToInternalEmail(studentId: string): string {
  const normalized = studentId.trim();
  if (!STUDENT_ID_PATTERN.test(normalized)) throw new Error("INVALID_STUDENT_ID");
  return `${normalized}@project-manager.local`;
}

export function canAccessManagedBusinessData(status: ManagedAccountStatus, metadata: ManagedAppMetadata): boolean {
  return status === "active" && metadata.must_change_password === false && metadata.account_active !== false;
}

export function canActAsSystemAdmin(
  profileRole: "user" | "admin",
  status: ManagedAccountStatus,
  metadata: ManagedAppMetadata
): boolean {
  return canAccessManagedBusinessData(status, metadata)
    && profileRole === "admin"
    && metadata.system_role === "admin";
}

export function deriveAdminUserStatus(
  status: ManagedAccountStatus,
  mustChangePassword: boolean,
  lastSignInAt: string | null
): "initial_login_pending" | "password_change_required" | "active" | "inactive" {
  if (status === "inactive") return "inactive";
  if (mustChangePassword || status === "password_change_required") return lastSignInAt ? "password_change_required" : "initial_login_pending";
  return "active";
}
