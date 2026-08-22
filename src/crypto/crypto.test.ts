import { describe, expect, it, vi } from "vitest";
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { base64UrlDecode, base64UrlEncode } from "./encoding";
import { decryptContent, encryptContent } from "./content";
import { createUserKeyring, protectUnlockedUserKeyring, unlockUserKeyring } from "./keyring";
import { createProjectKey, unwrapProjectKey, wrapExistingProjectKey } from "./projectKeys";
import { decryptFile, encryptFile } from "./files";

const projectId = "01932cb8-9c2a-7e0f-8a16-123456789abc";
const ownerId = "01932cb8-9c2a-7e0f-8a16-123456789abd";
const memberId = "01932cb8-9c2a-7e0f-8a16-123456789abe";

describe("client cryptography", () => {
  it("creates and unlocks a password-protected user keyring", async () => {
    const created = await createUserKeyring("dev password with enough entropy");
    const unlocked = await unlockUserKeyring("dev password with enough entropy", created.record);
    expect(unlocked.publicJwk.x).toBe(created.record.encryptionPublicKey.x);
    await expect(unlockUserKeyring("wrong password", created.record)).rejects.toThrow(/비밀번호/u);
  }, 30_000);

  it("re-protects an unlocked keyring after a password change", async () => {
    const created = await createUserKeyring("1234");
    const reprotected = await protectUnlockedUserKeyring("7281", created.keyring);
    await expect(unlockUserKeyring("1234", reprotected)).rejects.toThrow(/비밀번호/u);
    const unlocked = await unlockUserKeyring("7281", reprotected);
    expect(unlocked.publicJwk.x).toBe(created.record.encryptionPublicKey.x);
  }, 30_000);

  it("wraps one project DEK independently for multiple members", async () => {
    const owner = await createUserKeyring("owner password with enough entropy");
    const member = await createUserKeyring("member password with enough entropy");
    const project = await createProjectKey(owner.record.encryptionPublicKey, projectId, ownerId);
    const ownerKey = await unwrapProjectKey(
      { wrapped_key: project.wrapped.wrappedKey, ephemeral_public_key: project.wrapped.ephemeralPublicKey },
      owner.keyring,
      projectId,
      ownerId
    );
    const memberWrapped = await wrapExistingProjectKey(project.projectKey, member.record.encryptionPublicKey, projectId, memberId);
    const memberKey = await unwrapProjectKey(
      { wrapped_key: memberWrapped.wrappedKey, ephemeral_public_key: memberWrapped.ephemeralPublicKey },
      member.keyring,
      projectId,
      memberId
    );
    expect(ownerKey.extractable).toBe(false);
    expect(memberKey.extractable).toBe(false);
    const context = { projectId, entityType: "task-description" as const, entityId: crypto.randomUUID() };
    const encrypted = await encryptContent("shared project data", ownerKey, context);
    await expect(decryptContent(encrypted, memberKey, context)).resolves.toBe("shared project data");
  }, 30_000);

  it("authenticates ciphertext, IV, and AAD", async () => {
    const owner = await createUserKeyring("owner password with enough entropy");
    const project = await createProjectKey(owner.record.encryptionPublicKey, projectId, ownerId);
    const context = { projectId, entityType: "comment" as const, entityId: crypto.randomUUID() };
    const envelope = await encryptContent("SECRET_TEST_COMMENT_18291", project.projectKey, context);
    await expect(decryptContent(envelope, project.projectKey, context)).resolves.toBe("SECRET_TEST_COMMENT_18291");
    const changed = base64UrlDecode(envelope.ciphertext);
    changed[0] = (changed[0] ?? 0) ^ 1;
    await expect(decryptContent({ ...envelope, ciphertext: base64UrlEncode(changed) }, project.projectKey, context)).rejects.toThrow();
    await expect(decryptContent(envelope, project.projectKey, { ...context, entityId: crypto.randomUUID() })).rejects.toThrow();
    const again = await encryptContent("SECRET_TEST_COMMENT_18291", project.projectKey, context);
    expect(again.iv).not.toBe(envelope.iv);
  }, 30_000);

  it("round-trips encrypted attachment bytes without placing plaintext in the Storage blob", async () => {
    vi.stubGlobal("Blob", NodeBlob);
    vi.stubGlobal("File", NodeFile);
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const original = new TextEncoder().encode("CONFIDENTIAL_ATTACHMENT_BYTES_48291");
    const fileId = crypto.randomUUID();
    const encrypted = await encryptFile(new File([original], "notes.txt", { type: "text/plain" }), key, projectId, fileId);
    expect(await encrypted.encryptedBlob.text()).not.toContain("CONFIDENTIAL_ATTACHMENT_BYTES_48291");
    const decrypted = await decryptFile(encrypted.encryptedBlob, key, projectId, fileId, encrypted.checksum, "text/plain");
    expect(Array.from(new Uint8Array(await decrypted.arrayBuffer()))).toEqual(Array.from(original));
    vi.unstubAllGlobals();
  });
});
