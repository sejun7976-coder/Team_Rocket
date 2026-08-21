import { describe, expect, it } from "vitest";
import { canEnterBusinessRoutes, isSystemAdmin, mustChangePassword, validateNewPassword } from "./authPolicy";
import { studentIdToInternalEmail } from "./utils";
import type { Profile } from "../types/domain";
import {
  INITIAL_PASSWORD,
  canActAsSystemAdmin,
  deriveAdminUserStatus,
  studentIdToInternalEmail as edgeStudentIdToInternalEmail
} from "../../supabase/functions/_shared/accountPolicy";

const activeProfile = { system_role: "user", account_status: "active" } as Profile;

describe("managed account policy", () => {
  it("uses one deterministic internal-email rule without exposing a real mailbox", () => {
    expect(studentIdToInternalEmail("20260002")).toBe("20260002@project-manager.local");
    expect(edgeStudentIdToInternalEmail("20260002")).toBe(studentIdToInternalEmail("20260002"));
    expect(() => studentIdToInternalEmail("student-2")).toThrow(/학번/u);
  });

  it("fixes every server-created initial credential to 1234", () => {
    expect(INITIAL_PASSWORD).toBe("1234");
  });

  it("accepts exactly four numeric digits in PIN mode", () => {
    expect(validateNewPassword("pin", "0000")).toBeNull();
    expect(validateNewPassword("pin", "7281")).toBeNull();
    expect(validateNewPassword("pin", "123")).toMatch(/4자리/u);
    expect(validateNewPassword("pin", "12345")).toMatch(/4자리/u);
    expect(validateNewPassword("pin", "12a4")).toMatch(/숫자/u);
  });

  it("accepts a general password with a minimum length of four", () => {
    expect(validateNewPassword("password", "a!2Z")).toBeNull();
    expect(validateNewPassword("password", "abc")).toMatch(/4자/u);
  });

  it("blocks business routes until the server-managed flag is false", () => {
    const pendingUser = { app_metadata: { must_change_password: true, system_role: "user", account_active: true } };
    const readyUser = { app_metadata: { must_change_password: false, system_role: "user", account_active: true } };
    expect(mustChangePassword(pendingUser)).toBe(true);
    expect(canEnterBusinessRoutes(pendingUser, { ...activeProfile, account_status: "password_change_required" })).toBe(false);
    expect(canEnterBusinessRoutes(readyUser, activeProfile)).toBe(true);
    expect(canEnterBusinessRoutes(readyUser, { ...activeProfile, account_status: "inactive" })).toBe(false);
  });

  it("requires matching JWT metadata and profile role for system admin pages", () => {
    const adminUser = { app_metadata: { must_change_password: false, system_role: "admin" } };
    expect(isSystemAdmin(adminUser, { ...activeProfile, system_role: "admin" })).toBe(true);
    expect(isSystemAdmin(adminUser, activeProfile)).toBe(false);
    expect(isSystemAdmin({ app_metadata: { must_change_password: false, system_role: "user" } }, { ...activeProfile, system_role: "admin" })).toBe(false);
    expect(canActAsSystemAdmin("admin", "active", { must_change_password: false, system_role: "admin" })).toBe(true);
    expect(canActAsSystemAdmin("user", "active", { must_change_password: false, system_role: "admin" })).toBe(false);
    expect(canActAsSystemAdmin("admin", "active", { must_change_password: true, system_role: "admin" })).toBe(false);
  });

  it("derives the four administrator-facing account statuses", () => {
    expect(deriveAdminUserStatus("password_change_required", true, null)).toBe("initial_login_pending");
    expect(deriveAdminUserStatus("password_change_required", true, "2026-08-22T00:00:00Z")).toBe("password_change_required");
    expect(deriveAdminUserStatus("active", false, "2026-08-22T00:00:00Z")).toBe("active");
    expect(deriveAdminUserStatus("inactive", false, null)).toBe("inactive");
  });
});
