import { ApiError } from "./http.ts";
import { INITIAL_PASSWORD, STUDENT_ID_PATTERN, studentIdToInternalEmail } from "./accountPolicy.ts";

export { INITIAL_PASSWORD, studentIdToInternalEmail };

export function normalizeStudentId(value: unknown): string {
  if (typeof value !== "string" || !STUDENT_ID_PATTERN.test(value.trim())) {
    throw new ApiError(400, "INVALID_STUDENT_ID", "학번은 숫자 6~12자리여야 합니다.");
  }
  return value.trim();
}
