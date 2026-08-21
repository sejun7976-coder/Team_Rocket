import { describe, expect, it } from "vitest";
import recoveryMigration from "../../supabase/migrations/202608220005_recoverable_system_admin_bootstrap.sql?raw";
import bootstrapFunction from "../../supabase/functions/bootstrap-system-admin/index.ts?raw";
import bootstrapScript from "../../scripts/bootstrap-system-admin.mjs?raw";

describe("recoverable system administrator bootstrap", () => {
  it("classifies every partial and terminal identity state", () => {
    for (const safeState of [
      "BOOTSTRAP_ALREADY_COMPLETED_FOR_OTHER_USER",
      "BOOTSTRAP_COMPLETED_STATE_INVALID",
      "BOOTSTRAP_EXISTING_AUTH_USER_NOT_RECOVERABLE",
      "BOOTSTRAP_PROFILE_WITHOUT_MATCHING_AUTH_USER",
      "BOOTSTRAP_ANOTHER_ADMIN_EXISTS",
      "BOOTSTRAP_CLAIM_IN_PROGRESS",
      "BOOTSTRAP_CLAIM_NOT_ACTIVE",
      "BOOTSTRAP_AUTH_USER_INVALID",
      "BOOTSTRAP_IDENTITY_CONFLICT",
      "BOOTSTRAP_PROFILE_INVALID"
    ]) {
      expect(recoveryMigration).toContain(safeState);
      expect(bootstrapFunction).toContain(safeState);
    }
  });

  it("reuses the existing Auth UUID and repairs a missing profile", () => {
    expect(recoveryMigration).toContain("'user_id', v_auth_id");
    expect(recoveryMigration).toContain("insert into public.profiles(id, student_id, name, system_role, account_status)");
    expect(bootstrapFunction).toContain("let userId = state.user_id ?? null");
    expect(bootstrapFunction).toContain("p_user_id: userId");
  });

  it("never creates a duplicate before checking Auth and profile state", () => {
    const prepareIndex = bootstrapFunction.indexOf("let state = await prepare()");
    const createIndex = bootstrapFunction.indexOf("admin.auth.admin.createUser");
    expect(prepareIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeGreaterThan(prepareIndex);
    expect(bootstrapFunction).toContain("state = await prepare()");
  });

  it("preserves partial Auth state when finalize fails", () => {
    expect(bootstrapFunction).not.toContain("admin.auth.admin.deleteUser");
    expect(bootstrapFunction).not.toContain("release_system_admin_bootstrap\"");
    expect(bootstrapFunction).toContain("finalize_system_admin_bootstrap_recovery");
  });

  it("keeps a completed different administrator permanently blocked", () => {
    expect(recoveryMigration).toContain("raise exception using errcode = 'PBA01'");
    expect(recoveryMigration).toContain("BOOTSTRAP_ALREADY_COMPLETED_FOR_OTHER_USER");
  });

  it("prints only safe RPC/Auth diagnostics and applies recovery migration in the one command", () => {
    expect(bootstrapScript).toContain('["db", "push", "--project-ref", projectRef, "--yes"]');
    expect(bootstrapScript).toContain('"dbCode"');
    expect(bootstrapScript).toContain('"databaseError"');
    expect(bootstrapScript).toContain('"authCode"');
    expect(bootstrapScript).not.toContain("responseText)`");
  });
});
