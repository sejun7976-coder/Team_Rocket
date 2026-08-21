import type { EncryptionEnvelope } from "./types";
import { base64UrlDecode, base64UrlEncode, decodeUtf8, toArrayBuffer, utf8, wipe } from "./encoding";

export class CryptoIntegrityError extends Error {
  constructor(message = "암호화된 데이터를 확인할 수 없습니다.") {
    super(message);
    this.name = "CryptoIntegrityError";
  }
}

export async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.byteLength !== 32) throw new CryptoIntegrityError();
  return crypto.subtle.importKey("raw", toArrayBuffer(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptBytes(plaintext: Uint8Array, key: CryptoKey, aad: string): Promise<EncryptionEnvelope> {
  if (!aad || aad.length > 512) throw new Error("Invalid encryption context");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(utf8(aad)), tagLength: 128 },
    key,
    toArrayBuffer(plaintext)
  );
  return {
    version: 1,
    algorithm: "AES-256-GCM",
    iv: base64UrlEncode(iv),
    ciphertext: base64UrlEncode(new Uint8Array(ciphertext))
  };
}

export async function decryptBytes(envelope: EncryptionEnvelope, key: CryptoKey, aad: string): Promise<Uint8Array> {
  if (envelope.version !== 1 || envelope.algorithm !== "AES-256-GCM") throw new CryptoIntegrityError();
  const iv = base64UrlDecode(envelope.iv);
  if (iv.byteLength !== 12) throw new CryptoIntegrityError();
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(utf8(aad)), tagLength: 128 },
      key,
      toArrayBuffer(base64UrlDecode(envelope.ciphertext))
    );
    return new Uint8Array(plaintext);
  } catch {
    throw new CryptoIntegrityError();
  }
}

export async function encryptJson<T>(value: T, key: CryptoKey, aad: string): Promise<EncryptionEnvelope> {
  return encryptBytes(utf8(JSON.stringify(value)), key, aad);
}

export async function decryptJson<T>(envelope: EncryptionEnvelope, key: CryptoKey, aad: string): Promise<T> {
  const plaintext = await decryptBytes(envelope, key, aad);
  try {
    return JSON.parse(decodeUtf8(plaintext)) as T;
  } catch {
    throw new CryptoIntegrityError();
  } finally {
    wipe(plaintext);
  }
}
