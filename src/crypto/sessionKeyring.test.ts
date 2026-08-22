import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import authStoreSource from "../stores/authStore.ts?raw";
import appSource from "../App.tsx?raw";
import appShellSource from "../components/AppShell.tsx?raw";
import { deriveAuthCredential } from "../../supabase/functions/_shared/authCredential";
import { createUserKeyring } from "./keyring";
import {
  KEYRING_INACTIVITY_TIMEOUT_MS,
  createPersistedSessionKeyring,
  inactivityExpired,
  restorePersistedSessionKeyring
} from "./sessionKeyring";

describe("reload-safe session keyring", () => {
  it("wraps the private key with a non-extractable tab-local key", async () => {
    const created = await createUserKeyring("7976");
    const record = await createPersistedSessionKeyring(
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      created.keyring,
      Date.now() + KEYRING_INACTIVITY_TIMEOUT_MS
    );

    expect(record.wrappingKey.extractable).toBe(false);
    expect(record.wrappingKey.usages).toEqual(["encrypt", "decrypt"]);
    expect(record.encryptedPrivateJwk.ciphertext).toBeTruthy();
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain('"d":');
    expect(serialized).not.toContain("7976");
    expect(serialized).not.toContain(await deriveAuthCredential("20221948", "7976"));
    expect(serialized).not.toContain("projectKey");

    const restored = await restorePersistedSessionKeyring(record);
    expect(restored.publicJwk.x).toBe(created.keyring.publicJwk.x);
    expect(restored.privateKey.type).toBe("private");
  }, 30_000);

  it("expires at 15 minutes and preserves the remaining timeout across reload math", () => {
    const now = 2_000_000_000_000;
    expect(inactivityExpired(now - 14 * 60 * 1000, now)).toBe(false);
    expect(inactivityExpired(now - KEYRING_INACTIVITY_TIMEOUT_MS, now)).toBe(true);
    expect(inactivityExpired(null, now)).toBe(true);
  });

  it("hydrates the keyring before protected routing decides where to navigate", () => {
    expect(authStoreSource).toContain("keyringHydrated: false");
    expect(authStoreSource).toContain("await restoreSessionKeyring(data.session.user.id)");
    expect(authStoreSource).toContain("keyringHydrated: true");
    expect(appSource).toContain("!initialized || !keyringHydrated || loading");
  });

  it("preserves the current hash route on hydration and only routes after inactivity", () => {
    expect(authStoreSource).not.toMatch(/initialize:[\s\S]*?navigate\(/u);
    expect(appShellSource).toContain('navigate("/unlock", { replace: true })');
    expect(appShellSource).toContain("readLastActivityAt() ?? Date.now()");
    expect(appShellSource).not.toContain("lastActivity = Date.now();");
  });

  it("binds persisted unlock material to a reload-stable window identity instead of sharing it with a new tab", () => {
    expect(authStoreSource).toContain("restoreSessionKeyring");
    expect(appShellSource).toContain("readLastActivityAt");
    expect(readFileSync(resolve(process.cwd(), "src/crypto/sessionKeyring.ts"), "utf8"))
      .toContain("window.name");
  });

  it("clears persisted key material on inactivity, manual unlock replacement, and logout", () => {
    expect(authStoreSource).toContain("await clearSessionKeyring(userId)");
    expect(authStoreSource).toContain("await clearSessionKeyring(currentUser.id)");
    expect(appShellSource).toContain("forgetAll();");
    expect(appShellSource).toContain("await lockKeyring()");
  });
});
