import { describe, expect, it } from "vitest";

const frontendSources = import.meta.glob("../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true
}) as Record<string, string>;

describe("frontend secret and logging audit", () => {
  it("contains no server-only secret environment names or direct console logging", () => {
    for (const [path, source] of Object.entries(frontendSources)) {
      if (/\.test\.[jt]sx?$/u.test(path)) continue;
      expect(source, path).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|GITHUB_TOKEN|SUPABASE_SECRET_KEY/u);
      expect(source, path).not.toMatch(/console\.(log|info|warn|error)\s*\(/u);
    }
  });
});
