const MAX_USER_AGENT_LENGTH = 512;

export type AccessEventType = "login" | "logout" | "password_changed" | "session_refreshed";

function validIpv4(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255);
}

function validIpv6(value: string): boolean {
  return value.includes(":") && /^[0-9a-f:.]+$/iu.test(value) && value.length <= 45;
}

function normalizeIp(value: string | null): string | null {
  if (!value) return null;
  let candidate = value.split(",", 1)[0]?.trim() ?? "";
  if (candidate.startsWith("[") && candidate.includes("]")) {
    candidate = candidate.slice(1, candidate.indexOf("]"));
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/u.test(candidate)) {
    candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  }
  return validIpv4(candidate) || validIpv6(candidate) ? candidate : null;
}

function countryCode(value: string | null): string | null {
  const candidate = value?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}$/u.test(candidate) && candidate !== "XX" ? candidate : null;
}

/**
 * These headers are supplied by the hosted Edge gateway. JSON body fields are
 * deliberately ignored so a caller cannot choose the recorded network data.
 */
export function accessMetadataFromRequest(request: Request): {
  ipAddress: string | null;
  countryCode: string | null;
  userAgent: string | null;
} {
  const forwardedFor = request.headers.get("x-forwarded-for")
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1) ?? null;
  const ipAddress = normalizeIp(
    request.headers.get("cf-connecting-ip")
      ?? request.headers.get("x-real-ip")
      ?? forwardedFor
  );
  const rawAgent = request.headers.get("user-agent")?.trim() ?? "";
  return {
    ipAddress,
    countryCode: countryCode(request.headers.get("cf-ipcountry")),
    userAgent: rawAgent ? rawAgent.slice(0, MAX_USER_AGENT_LENGTH) : null
  };
}

export function isAccessEventType(value: unknown): value is AccessEventType {
  return value === "login"
    || value === "logout"
    || value === "password_changed"
    || value === "session_refreshed";
}

export function describeUserAgent(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const browser = /Edg\//u.test(userAgent) ? "Edge"
    : /OPR\//u.test(userAgent) ? "Opera"
      : /Chrome\//u.test(userAgent) ? "Chrome"
        : /Firefox\//u.test(userAgent) ? "Firefox"
          : /Safari\//u.test(userAgent) ? "Safari"
            : "기타 브라우저";
  const platform = /Android/u.test(userAgent) ? "Android"
    : /iPhone|iPad|iPod/u.test(userAgent) ? "iOS"
      : /Windows/u.test(userAgent) ? "Windows"
        : /Macintosh|Mac OS X/u.test(userAgent) ? "macOS"
          : /Linux/u.test(userAgent) ? "Linux"
            : "기타 기기";
  return `${browser} · ${platform}`;
}
