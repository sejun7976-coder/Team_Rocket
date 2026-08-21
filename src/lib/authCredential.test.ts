import { describe, expect, it } from "vitest";
import {
  AUTH_CREDENTIAL_HEX_LENGTH,
  deriveAuthCredential,
  deriveInitialAuthCredential
} from "../../supabase/functions/_shared/authCredential";
import { INITIAL_PASSWORD } from "../../supabase/functions/_shared/accountPolicy";
import authStoreSource from "../stores/authStore.ts?raw";
import adminCreateUserSource from "../../supabase/functions/admin-create-user/index.ts?raw";
import adminResetPasswordSource from "../../supabase/functions/admin-reset-password/index.ts?raw";
import bootstrapSystemAdminSource from "../../supabase/functions/bootstrap-system-admin/index.ts?raw";
import credentialUtilitySource from "../../supabase/functions/_shared/authCredential.ts?raw";

const STUDENT_A = "20260002";
const STUDENT_B = "20260003";

class InMemoryHostedAuth {
  private readonly storedCredentials = new Map<string, string>();

  setDerivedPassword(studentId: string, derivedCredential: string): void {
    this.storedCredentials.set(studentId, derivedCredential);
  }

  async signIn(studentId: string, enteredCredential: string): Promise<boolean> {
    const submittedCredential = await deriveAuthCredential(studentId, enteredCredential);
    return this.storedCredentials.get(studentId) === submittedCredential;
  }
}

describe("Supabase Auth credential compatibility layer", () => {
  it("derives the same credential for the same student ID and PIN", async () => {
    const first = await deriveAuthCredential(STUDENT_A, "7976");
    const second = await deriveAuthCredential(STUDENT_A, "7976");
    expect(first).toBe(second);
  });

  it("separates different PINs for the same student ID", async () => {
    await expect(deriveAuthCredential(STUDENT_A, "7976")).resolves.not.toBe(
      await deriveAuthCredential(STUDENT_A, "1234")
    );
  });

  it("separates the same PIN for different student IDs", async () => {
    await expect(deriveAuthCredential(STUDENT_A, "7976")).resolves.not.toBe(
      await deriveAuthCredential(STUDENT_B, "7976")
    );
  });

  it("returns a deterministic SHA-256 hex credential longer than the Hosted Auth minimum", async () => {
    const derived = await deriveAuthCredential(STUDENT_A, "1234");
    expect(derived).toMatch(/^[0-9a-f]{64}$/u);
    expect(derived).toHaveLength(AUTH_CREDENTIAL_HEX_LENGTH);
    expect(derived.length).toBeGreaterThanOrEqual(6);
    expect(derived).not.toBe("1234");
  });

  it("allows a newly created user to authenticate with the visible initial credential 1234", async () => {
    const auth = new InMemoryHostedAuth();
    auth.setDerivedPassword(STUDENT_A, await deriveInitialAuthCredential(STUDENT_A));
    await expect(auth.signIn(STUDENT_A, INITIAL_PASSWORD)).resolves.toBe(true);
  });

  it("allows authentication with an exact four-digit PIN after password change", async () => {
    const auth = new InMemoryHostedAuth();
    auth.setDerivedPassword(STUDENT_A, await deriveAuthCredential(STUDENT_A, "7976"));
    await expect(auth.signIn(STUDENT_A, "7976")).resolves.toBe(true);
    await expect(auth.signIn(STUDENT_A, "1234")).resolves.toBe(false);
  });

  it("allows 1234 authentication again after an administrator reset", async () => {
    const auth = new InMemoryHostedAuth();
    auth.setDerivedPassword(STUDENT_A, await deriveAuthCredential(STUDENT_A, "7976"));
    auth.setDerivedPassword(STUDENT_A, await deriveInitialAuthCredential(STUDENT_A));
    await expect(auth.signIn(STUDENT_A, INITIAL_PASSWORD)).resolves.toBe(true);
  });

  it("never passes raw credentials to a Supabase Auth password field", () => {
    expect(authStoreSource).toContain("password: authCredential");
    expect(authStoreSource).not.toMatch(/signInWithPassword\([\s\S]*?password:\s*credential[\s\S]*?\}\)/u);
    expect(authStoreSource).not.toMatch(/auth\.updateUser\(\{\s*password:\s*newCredential/u);
    for (const source of [adminCreateUserSource, adminResetPasswordSource, bootstrapSystemAdminSource]) {
      expect(source).toContain("password: authCredential");
      expect(source).not.toContain("password: INITIAL_PASSWORD");
    }
  });

  it("does not expose derived credentials through logs, responses, UI, or browser storage", () => {
    const authBoundarySources = [
      authStoreSource,
      adminCreateUserSource,
      adminResetPasswordSource,
      bootstrapSystemAdminSource,
      credentialUtilitySource
    ];
    for (const source of authBoundarySources) {
      expect(source).not.toMatch(/console\.(?:log|info|warn|error)\([^\n]*authCredential/u);
      expect(source).not.toMatch(/(?:localStorage|sessionStorage|indexedDB)[^\n]*authCredential/iu);
      expect(source).not.toMatch(/(?:json|reply)\([^\n]*authCredential/u);
    }
  });
});
