import { decryptBytes, encryptBytes, importAesKey } from "./aes";
import { toArrayBuffer, utf8, wipe } from "./encoding";
import type { ProjectKeyRecord, UnlockedUserKeyring, WrappedProjectKey } from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const projectKeyMaterial = new WeakMap<CryptoKey, Uint8Array>();

function assertIds(projectId: string, userId: string): void {
  if (!UUID_PATTERN.test(projectId) || !UUID_PATTERN.test(userId)) throw new Error("Invalid project key context");
}

function wrapAad(projectId: string, userId: string): string {
  assertIds(projectId, userId);
  return `rocket:project-key:v1:${projectId}:${userId}`;
}

async function deriveWrapKey(privateKey: CryptoKey, publicKey: CryptoKey, projectId: string, userId: string): Promise<CryptoKey> {
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256)
  );
  try {
    const material = await crypto.subtle.importKey("raw", toArrayBuffer(shared), "HKDF", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: toArrayBuffer(utf8(projectId)),
        info: toArrayBuffer(utf8(`rocket:project-wrap:v1:${userId}`))
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  } finally {
    wipe(shared);
  }
}

export async function wrapProjectKey(
  rawProjectKey: Uint8Array,
  recipientPublicJwk: JsonWebKey,
  projectId: string,
  userId: string
): Promise<WrappedProjectKey> {
  assertIds(projectId, userId);
  if (rawProjectKey.byteLength !== 32) throw new Error("Project key must be 256 bits");
  const recipientPublicKey = await crypto.subtle.importKey(
    "jwk",
    recipientPublicJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const ephemeral = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  )) as CryptoKeyPair;
  const wrappingKey = await deriveWrapKey(ephemeral.privateKey, recipientPublicKey, projectId, userId);
  return {
    wrappedKey: await encryptBytes(rawProjectKey, wrappingKey, wrapAad(projectId, userId)),
    ephemeralPublicKey: await crypto.subtle.exportKey("jwk", ephemeral.publicKey)
  };
}

export async function createProjectKey(
  recipientPublicJwk: JsonWebKey,
  projectId: string,
  userId: string
): Promise<{ projectKey: CryptoKey; wrapped: WrappedProjectKey }> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  try {
    const [projectKey, wrapped] = await Promise.all([
      importAesKey(raw),
      wrapProjectKey(raw, recipientPublicJwk, projectId, userId)
    ]);
    projectKeyMaterial.set(projectKey, raw.slice());
    return { projectKey, wrapped };
  } finally {
    wipe(raw);
  }
}

export async function unwrapProjectKey(
  record: ProjectKeyRecord,
  keyring: UnlockedUserKeyring,
  projectId: string,
  userId: string
): Promise<CryptoKey> {
  const ephemeralPublic = await crypto.subtle.importKey(
    "jwk",
    record.ephemeral_public_key,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const wrappingKey = await deriveWrapKey(keyring.privateKey, ephemeralPublic, projectId, userId);
  const raw = await decryptBytes(record.wrapped_key, wrappingKey, wrapAad(projectId, userId));
  try {
    const projectKey = await importAesKey(raw);
    projectKeyMaterial.set(projectKey, raw.slice());
    return projectKey;
  } finally {
    wipe(raw);
  }
}

export async function wrapExistingProjectKey(
  projectKey: CryptoKey,
  recipientPublicJwk: JsonWebKey,
  projectId: string,
  userId: string
): Promise<WrappedProjectKey> {
  const raw = projectKeyMaterial.get(projectKey);
  if (!raw) throw new Error("Project key material is not available; unlock the project again.");
  return wrapProjectKey(raw, recipientPublicJwk, projectId, userId);
}

export function forgetProjectKey(projectKey: CryptoKey): void {
  const raw = projectKeyMaterial.get(projectKey);
  if (raw) wipe(raw);
  projectKeyMaterial.delete(projectKey);
}
