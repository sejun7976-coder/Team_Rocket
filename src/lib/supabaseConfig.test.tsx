import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import viteConfigSource from "../../vite.config.ts?raw";
import { ConfigurationErrorScreen } from "../components/ConfigurationErrorScreen";
import {
  LOCAL_SUPABASE_PUBLISHABLE_KEY,
  LOCAL_SUPABASE_URL,
  assertProductionSupabaseConfiguration,
  normalizeEnvironmentValue,
  resolveSupabaseConfiguration
} from "./supabaseConfig";

const validEnvironment = {
  VITE_SUPABASE_URL: "https://example-project.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test"
};

describe("Supabase browser environment configuration", () => {
  it("trims configured values before using them", () => {
    const configuration = resolveSupabaseConfiguration({
      VITE_SUPABASE_URL: `  ${validEnvironment.VITE_SUPABASE_URL}  `,
      VITE_SUPABASE_PUBLISHABLE_KEY: `  ${validEnvironment.VITE_SUPABASE_PUBLISHABLE_KEY}\n`
    });
    expect(configuration.configured).toBe(true);
    expect(configuration.clientUrl).toBe(validEnvironment.VITE_SUPABASE_URL);
    expect(configuration.clientPublishableKey).toBe(validEnvironment.VITE_SUPABASE_PUBLISHABLE_KEY);
  });

  it("treats empty strings as missing", () => {
    const configuration = resolveSupabaseConfiguration({
      VITE_SUPABASE_URL: "",
      VITE_SUPABASE_PUBLISHABLE_KEY: ""
    });
    expect(configuration.configured).toBe(false);
    expect(configuration.issues).toEqual(["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"]);
  });

  it("treats whitespace-only strings as missing", () => {
    expect(normalizeEnvironmentValue(" \n\t ")).toBeNull();
    expect(resolveSupabaseConfiguration({
      VITE_SUPABASE_URL: "   ",
      VITE_SUPABASE_PUBLISHABLE_KEY: "\t"
    }).configured).toBe(false);
  });

  it("uses non-throwing local placeholders for an unconfigured runtime", () => {
    const configuration = resolveSupabaseConfiguration({});
    expect(configuration.clientUrl).toBe(LOCAL_SUPABASE_URL);
    expect(configuration.clientPublishableKey).toBe(LOCAL_SUPABASE_PUBLISHABLE_KEY);
  });

  it("rejects a malformed or credential-bearing Supabase URL", () => {
    expect(resolveSupabaseConfiguration({
      ...validEnvironment,
      VITE_SUPABASE_URL: "not-a-url"
    }).issues).toContain("VITE_SUPABASE_URL");
    expect(resolveSupabaseConfiguration({
      ...validEnvironment,
      VITE_SUPABASE_URL: "https://user:password@example.supabase.co"
    }).issues).toContain("VITE_SUPABASE_URL");
  });

  it("fails a production build without printing configured values", () => {
    let thrown: unknown;
    try {
      assertProductionSupabaseConfiguration({
        VITE_SUPABASE_URL: " ",
        VITE_SUPABASE_PUBLISHABLE_KEY: "do-not-print-this-key"
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("VITE_SUPABASE_URL");
    expect((thrown as Error).message).not.toContain("do-not-print-this-key");
  });

  it("allows a production build when both trimmed values are valid", () => {
    expect(() => assertProductionSupabaseConfiguration(validEnvironment)).not.toThrow();
    expect(viteConfigSource).toContain('command === "build" && mode === "production"');
    expect(viteConfigSource).toContain("assertProductionSupabaseConfiguration(environment)");
  });

  it("renders an actionable configuration screen instead of a blank page", () => {
    render(<ConfigurationErrorScreen issues={["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"]} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("서비스 설정을 확인해 주세요.")).toBeInTheDocument();
    expect(screen.getByText("VITE_SUPABASE_URL")).toBeInTheDocument();
    expect(screen.getByText("VITE_SUPABASE_PUBLISHABLE_KEY")).toBeInTheDocument();
  });
});
