const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/gu;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/giu;
const SECRET_TOKEN_PATTERN = /\b(?:sk|sb_secret|service_role)[-_][A-Za-z0-9_-]{12,}\b/giu;
const LABELED_SECRET_PATTERN = /((?:api[_ -]?key|service[_ -]?role(?:[_ -]?key)?|project[_ -]?encryption[_ -]?key|encryption[_ -]?key|private[_ -]?key|secret|password|credential|access[_ -]?token|refresh[_ -]?token|jwt|pin)\s*[:=]\s*)[^\s,;]+/giu;

export function redactSensitiveText(value: string, maximum = 4_000): string {
  const redacted = value
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(JWT_PATTERN, "[REDACTED_JWT]")
    .replace(SECRET_TOKEN_PATTERN, "[REDACTED_SECRET]")
    .replace(LABELED_SECRET_PATTERN, "$1[REDACTED]")
    .trim()
    .slice(0, maximum);
  return redacted || "[민감 정보 제거됨]";
}
