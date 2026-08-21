export type FirstLoginAction = "already_completed" | "update_credential_and_finalize" | "reconcile_metadata";

export function decideFirstLoginAction(
  mustChangePassword: boolean,
  profileStatus: "password_change_required" | "active" | "inactive",
  keyringInitialized: boolean
): FirstLoginAction {
  if (!mustChangePassword && profileStatus === "active" && keyringInitialized) return "already_completed";
  if (profileStatus === "active" && keyringInitialized) return "reconcile_metadata";
  return "update_credential_and_finalize";
}

export function isSamePasswordAuthError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code === "same_password") return true;
  return typeof candidate.message === "string"
    && /same password|different from the old password/iu.test(candidate.message);
}
