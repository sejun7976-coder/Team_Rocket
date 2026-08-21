import { decryptJson, encryptJson } from "./aes";
import type { EncryptionContext, EncryptionEnvelope } from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function contentAad(context: EncryptionContext): string {
  if (!UUID_PATTERN.test(context.projectId) || !UUID_PATTERN.test(context.entityId)) throw new Error("Invalid content context");
  return `rocket:v1:${context.projectId}:${context.entityType}:${context.entityId}`;
}

export async function encryptContent<T>(value: T, projectKey: CryptoKey, context: EncryptionContext): Promise<EncryptionEnvelope> {
  return encryptJson(value, projectKey, contentAad(context));
}

export async function decryptContent<T>(envelope: EncryptionEnvelope, projectKey: CryptoKey, context: EncryptionContext): Promise<T> {
  return decryptJson<T>(envelope, projectKey, contentAad(context));
}
