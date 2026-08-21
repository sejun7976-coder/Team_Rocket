import { ApiError } from "./http.ts";

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]{1,100}$/u;
export const GITHUB_USER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new ApiError(400, "INVALID_INPUT", `${field}가 올바르지 않습니다.`);
  return value;
}

export function requireText(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) {
    throw new ApiError(400, "INVALID_INPUT", `${field}가 올바르지 않습니다.`);
  }
  return value.trim();
}

export function requireRepositoryName(value: unknown): string {
  const name = requireText(value, "Repository 이름", 1, 100);
  if (!REPOSITORY_PATTERN.test(name) || name === "." || name === "..") {
    throw new ApiError(400, "INVALID_REPOSITORY_NAME", "Repository 이름이 올바르지 않습니다.");
  }
  return name;
}

export function requireKeyEnvelope(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "INVALID_KEY_ENVELOPE", `${field}가 올바르지 않습니다.`);
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || record.algorithm !== "AES-256-GCM" || typeof record.iv !== "string" || typeof record.ciphertext !== "string") {
    throw new ApiError(400, "INVALID_KEY_ENVELOPE", `${field}가 올바르지 않습니다.`);
  }
  return record;
}

export function requirePublicJwk(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "INVALID_PUBLIC_KEY", "공개키가 올바르지 않습니다.");
  const key = value as Record<string, unknown>;
  if (key.kty !== "EC" || key.crv !== "P-256" || typeof key.x !== "string" || typeof key.y !== "string") {
    throw new ApiError(400, "INVALID_PUBLIC_KEY", "공개키가 올바르지 않습니다.");
  }
  return { kty: "EC", crv: "P-256", x: key.x, y: key.y, ext: true };
}
