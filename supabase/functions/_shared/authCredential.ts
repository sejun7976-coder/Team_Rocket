import { INITIAL_PASSWORD, STUDENT_ID_PATTERN } from "./accountPolicy.ts";

export const AUTH_CREDENTIAL_NAMESPACE = "rocket-campus-auth:v1" as const;
export const AUTH_CREDENTIAL_HEX_LENGTH = 64;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function deriveAuthCredential(studentId: string, credential: string): Promise<string> {
  const normalizedStudentId = studentId.trim();
  if (!STUDENT_ID_PATTERN.test(normalizedStudentId)) throw new Error("INVALID_STUDENT_ID");
  if (typeof credential !== "string" || credential.length === 0) throw new Error("INVALID_CREDENTIAL");

  const source = `${AUTH_CREDENTIAL_NAMESPACE}:${normalizedStudentId}:${credential}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return bytesToHex(new Uint8Array(digest));
}

export function deriveInitialAuthCredential(studentId: string): Promise<string> {
  return deriveAuthCredential(studentId, INITIAL_PASSWORD);
}
