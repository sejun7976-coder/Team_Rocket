export const LOCAL_SUPABASE_URL = "http://127.0.0.1:54321";
export const LOCAL_SUPABASE_PUBLISHABLE_KEY = "local-development-publishable-key";

export type SupabaseEnvironmentName = "VITE_SUPABASE_URL" | "VITE_SUPABASE_PUBLISHABLE_KEY";

export interface SupabaseEnvironment {
  VITE_SUPABASE_URL?: unknown;
  VITE_SUPABASE_PUBLISHABLE_KEY?: unknown;
}

export interface ResolvedSupabaseConfiguration {
  configured: boolean;
  clientUrl: string;
  clientPublishableKey: string;
  issues: SupabaseEnvironmentName[];
}

export function normalizeEnvironmentValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isSupportedSupabaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "https:" || parsed.protocol === "http:")
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password;
  } catch {
    return false;
  }
}

export function resolveSupabaseConfiguration(environment: SupabaseEnvironment): ResolvedSupabaseConfiguration {
  const candidateUrl = normalizeEnvironmentValue(environment.VITE_SUPABASE_URL);
  const candidateKey = normalizeEnvironmentValue(environment.VITE_SUPABASE_PUBLISHABLE_KEY);
  const url = candidateUrl && isSupportedSupabaseUrl(candidateUrl) ? candidateUrl : null;
  const issues: SupabaseEnvironmentName[] = [];
  if (!url) issues.push("VITE_SUPABASE_URL");
  if (!candidateKey) issues.push("VITE_SUPABASE_PUBLISHABLE_KEY");

  return {
    configured: issues.length === 0,
    clientUrl: url ?? LOCAL_SUPABASE_URL,
    clientPublishableKey: candidateKey ?? LOCAL_SUPABASE_PUBLISHABLE_KEY,
    issues
  };
}

export function assertProductionSupabaseConfiguration(environment: SupabaseEnvironment): void {
  const configuration = resolveSupabaseConfiguration(environment);
  if (!configuration.configured) {
    throw new Error(
      `[supabase-config] Production build aborted. Missing or invalid GitHub Actions variables: ${configuration.issues.join(", ")}`
    );
  }
}
