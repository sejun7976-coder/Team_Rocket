import { describe, expect, it } from "vitest";
import {
  decideFirstLoginAction,
  isSamePasswordAuthError
} from "../../supabase/functions/_shared/firstLoginPolicy";
import edgeSource from "../../supabase/functions/complete-first-login/index.ts?raw";
import migrationSource from "../../supabase/migrations/202608220006_idempotent_first_login.sql?raw";
import authStoreSource from "../stores/authStore.ts?raw";
import appSource from "../App.tsx?raw";
import authPagesSource from "../pages/AuthPages.tsx?raw";
import corsPolicySource from "../../supabase/functions/_shared/corsPolicy.ts?raw";
import { needsFirstLogin } from "./authPolicy";
import type { Profile } from "../types/domain";

const pendingUser = { app_metadata: { must_change_password: true, account_active: true } };
const readyUser = { app_metadata: { must_change_password: false, account_active: true } };
const completeProfile = {
  account_status: "active",
  encryption_public_key: { kty: "EC" },
  encrypted_private_key: { version: 1 },
  key_salt: "0123456789012345678901"
} as Profile;

describe("recoverable first-login orchestration", () => {
  it("starts credential update for a normal pending account", () => {
    expect(decideFirstLoginAction(true, "password_change_required", false)).toBe("update_credential_and_finalize");
  });

  it("continues finalize when Auth already has the new password", () => {
    expect(decideFirstLoginAction(true, "password_change_required", false)).toBe("update_credential_and_finalize");
    expect(isSamePasswordAuthError({ code: "same_password" })).toBe(true);
  });

  it("returns idempotent success for a fully completed account", () => {
    expect(decideFirstLoginAction(false, "active", true)).toBe("already_completed");
  });

  it("repairs an active profile whose keyring is missing", () => {
    expect(decideFirstLoginAction(false, "active", false)).toBe("update_credential_and_finalize");
    expect(needsFirstLogin(readyUser, { ...completeProfile, encryption_public_key: null })).toBe(true);
  });

  it("repairs stale Auth metadata after profile and keyring commit", () => {
    expect(decideFirstLoginAction(true, "active", true)).toBe("reconcile_metadata");
    expect(needsFirstLogin(pendingUser, completeProfile)).toBe(true);
  });

  it("does not mistake unrelated Auth failures for an idempotent retry", () => {
    expect(isSamePasswordAuthError({ code: "weak_password", message: "rejected" })).toBe(false);
    expect(isSamePasswordAuthError(null)).toBe(false);
  });

  it("orders password, atomic DB finalize, metadata, then final verification", () => {
    const password = edgeSource.indexOf('phase = "credential_update"');
    const profile = edgeSource.indexOf('phase = "profile_finalize"');
    const metadata = edgeSource.indexOf('phase = "metadata_update"');
    const verify = edgeSource.indexOf('phase = "verify"');
    expect(password).toBeGreaterThan(-1);
    expect(profile).toBeGreaterThan(password);
    expect(metadata).toBeGreaterThan(profile);
    expect(verify).toBeGreaterThan(metadata);
  });

  it("sends only the derived Auth credential and encrypted keyring to Edge", () => {
    expect(authStoreSource).toContain("derivedCredential: authCredential");
    expect(authStoreSource).toContain("keyring: record");
    expect(authStoreSource).not.toContain("supabase.auth.updateUser");
    expect(edgeSource).not.toContain("newCredential");
  });

  it("retries without sleeps and rebuilds state from refreshed server data", () => {
    expect(authStoreSource).toContain("attempt < 2");
    expect(authStoreSource).toContain("supabase.auth.refreshSession()");
    expect(authStoreSource).toContain("supabase.auth.getUser()");
    expect(authStoreSource).toContain("const profile = await fetchProfile(userId)");
    expect(authStoreSource).not.toMatch(/setTimeout|sleep\s*\(/u);
  });

  it("atomically preserves an already committed keyring and exposes no browser RPC grant", () => {
    expect(migrationSource).toContain("for update");
    expect(migrationSource).toContain("case when v_keyring_reused then encryption_public_key else p_encryption_public_key end");
    expect(migrationSource).toContain("from public, anon, authenticated;");
    expect(migrationSource).toContain("to service_role;");
  });

  it("keeps every route on first-login while either durable or mirrored state is incomplete", () => {
    expect(needsFirstLogin(pendingUser, completeProfile)).toBe(true);
    expect(needsFirstLogin(readyUser, { ...completeProfile, account_status: "password_change_required" })).toBe(true);
    expect(needsFirstLogin(readyUser, completeProfile)).toBe(false);
    expect(appSource).toContain("needsFirstLogin(user, profile)");
    expect(authPagesSource).toContain("needsFirstLogin(user, profile)");
  });

  it("shows a recovery-safe retry message instead of claiming the password did not change", () => {
    expect(authStoreSource).toContain("로그인 암호는 변경되었을 수 있지만 계정 초기 설정을 완료하지 못했습니다");
    expect(authPagesSource).toContain("로그인할 때 사용한 새 PIN 또는 비밀번호를 그대로 입력");
  });

  it("normalizes a pathful GitHub Pages URL before comparing browser Origin", () => {
    expect(corsPolicySource).toContain("new URL(configuredFrontendUrl).origin");
    expect(corsPolicySource).not.toContain("requestOrigin === configuredFrontendUrl");
  });

  it("uses structured allowlisted logs without credentials, JWTs, or key material", () => {
    expect(edgeSource).toContain('event: "first_login_failed"');
    expect(edgeSource).toContain("mustChangeBefore");
    expect(edgeSource).not.toMatch(/console\.(?:info|error)\([^\n]*(?:derivedCredential|keySalt|encryptedPrivateKey|authorization|jwt)/iu);
  });
});
