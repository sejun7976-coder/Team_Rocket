import { decryptJson, encryptJson } from "./aes";
import { base64UrlDecode, base64UrlEncode, toArrayBuffer, utf8, wipe } from "./encoding";
import type { UnlockedUserKeyring, UserKeyringRecord } from "./types";

export const USER_KEK_ITERATIONS = 310_000;
const KEYRING_AAD = "rocket:keyring:v1";

async function deriveUserKek(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  if (iterations < USER_KEK_ITERATIONS || salt.byteLength < 16) throw new Error("지원하지 않는 keyring 설정입니다.");
  const passwordBytes = utf8(password);
  try {
    const material = await crypto.subtle.importKey("raw", toArrayBuffer(passwordBytes), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(salt), iterations },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  } finally {
    wipe(passwordBytes);
  }
}

async function importKeyring(publicJwk: JsonWebKey, privateJwk: JsonWebKey): Promise<UnlockedUserKeyring> {
  const [publicKey, privateKey] = await Promise.all([
    crypto.subtle.importKey("jwk", publicJwk, { name: "ECDH", namedCurve: "P-256" }, true, []),
    crypto.subtle.importKey("jwk", privateJwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])
  ]);
  return { publicKey, privateKey, publicJwk };
}

export async function createUserKeyring(password: string): Promise<{ record: UserKeyringRecord; keyring: UnlockedUserKeyring }> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const [publicJwk, privateJwk] = await Promise.all([
    crypto.subtle.exportKey("jwk", pair.publicKey),
    crypto.subtle.exportKey("jwk", pair.privateKey)
  ]);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kek = await deriveUserKek(password, salt, USER_KEK_ITERATIONS);
  const encryptedPrivateKey = await encryptJson(privateJwk, kek, KEYRING_AAD);
  return {
    record: {
      encryptionPublicKey: publicJwk,
      encryptedPrivateKey,
      keySalt: base64UrlEncode(salt),
      keyKdfIterations: USER_KEK_ITERATIONS
    },
    keyring: await importKeyring(publicJwk, privateJwk)
  };
}

export async function unlockUserKeyring(password: string, record: UserKeyringRecord): Promise<UnlockedUserKeyring> {
  const salt = base64UrlDecode(record.keySalt);
  const kek = await deriveUserKek(password, salt, record.keyKdfIterations);
  let privateJwk: JsonWebKey;
  try {
    privateJwk = await decryptJson<JsonWebKey>(record.encryptedPrivateKey, kek, KEYRING_AAD);
  } catch {
    throw new Error("비밀번호가 올바르지 않거나 keyring이 손상되었습니다.");
  }
  return importKeyring(record.encryptionPublicKey, privateJwk);
}

export async function protectUnlockedUserKeyring(password: string, keyring: UnlockedUserKeyring): Promise<UserKeyringRecord> {
  const privateJwk = await crypto.subtle.exportKey("jwk", keyring.privateKey);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kek = await deriveUserKek(password, salt, USER_KEK_ITERATIONS);
  return {
    encryptionPublicKey: keyring.publicJwk,
    encryptedPrivateKey: await encryptJson(privateJwk, kek, KEYRING_AAD),
    keySalt: base64UrlEncode(salt),
    keyKdfIterations: USER_KEK_ITERATIONS
  };
}
