import type { Session, User } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { deriveAuthCredential } from "../../supabase/functions/_shared/authCredential";
import {
  reauthenticateAfterFirstLogin,
  type FirstLoginAuthClient
} from "./firstLoginReauthentication";

const studentId = "20221948";
const user = { id: "11111111-1111-4111-8111-111111111111" } as User;
const session = { access_token: "session-token", user } as Session;

function clientFixture(overrides?: { signInError?: unknown; verifiedUser?: User | null }) {
  const signInWithPassword = vi.fn(async (credentials: { email: string; password: string }) => {
    void credentials;
    return {
      data: overrides?.signInError ? { session: null, user: null } : { session, user },
      error: overrides?.signInError ?? null
    };
  });
  const getSession = vi.fn(async () => ({ data: { session }, error: null }));
  const getUser = vi.fn(async () => ({
    data: { user: overrides && "verifiedUser" in overrides ? overrides.verifiedUser ?? null : user },
    error: null
  }));
  return {
    client: { auth: { signInWithPassword, getSession, getUser } } as FirstLoginAuthClient,
    signInWithPassword,
    getSession,
    getUser
  };
}

describe("first-login automatic reauthentication", () => {
  it("signs in with the newly derived PIN and verifies the rebuilt session", async () => {
    const fixture = clientFixture();
    const result = await reauthenticateAfterFirstLogin(
      fixture.client,
      studentId,
      user.id,
      "7976"
    );

    expect(fixture.signInWithPassword).toHaveBeenCalledWith({
      email: "20221948@project-manager.local",
      password: await deriveAuthCredential(studentId, "7976")
    });
    expect(fixture.signInWithPassword.mock.calls[0]?.[0].password).not.toBe("7976");
    expect(fixture.getSession).toHaveBeenCalledOnce();
    expect(fixture.getUser).toHaveBeenCalledOnce();
    expect(result).toEqual({ session, user });
  });

  it("uses the same path for a general password without exposing its raw value", async () => {
    const fixture = clientFixture();
    const raw = "new-general-password";
    await reauthenticateAfterFirstLogin(fixture.client, studentId, user.id, raw);
    const sent = fixture.signInWithPassword.mock.calls[0]?.[0].password;
    expect(sent).toBe(await deriveAuthCredential(studentId, raw));
    expect(sent).not.toContain(raw);
  });

  it("fails closed when sign-in fails instead of trying to refresh the old session", async () => {
    const fixture = clientFixture({ signInError: { code: "invalid_credentials" } });
    await expect(reauthenticateAfterFirstLogin(fixture.client, studentId, user.id, "7976"))
      .rejects.toThrow("FIRST_LOGIN_REAUTHENTICATION_FAILED");
    expect(fixture.getSession).not.toHaveBeenCalled();
    expect(fixture.getUser).not.toHaveBeenCalled();
    expect("refreshSession" in fixture.client.auth).toBe(false);
  });

  it("rejects a session that resolves to another user", async () => {
    const fixture = clientFixture({ verifiedUser: { ...user, id: "22222222-2222-4222-8222-222222222222" } });
    await expect(reauthenticateAfterFirstLogin(fixture.client, studentId, user.id, "7976"))
      .rejects.toThrow("FIRST_LOGIN_REAUTHENTICATION_FAILED");
  });
});
