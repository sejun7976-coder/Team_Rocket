import { describe, expect, it, vi } from "vitest";
import {
  GitHubConfigurationError,
  githubConfigurationDiagnostic,
  resolveGitHubConfiguration,
  type GitHubConfigurationInput
} from "../../supabase/functions/_shared/githubConfiguration.ts";
import { GitHubClient } from "../../supabase/functions/_shared/githubClient.ts";
import { GITHUB_USER_PATTERN } from "../../supabase/functions/_shared/githubUsername.ts";
import githubSource from "../../supabase/functions/_shared/github.ts?raw";
import createProjectSource from "../../supabase/functions/create-project/index.ts?raw";
import githubRetrySource from "../../supabase/functions/github-retry/index.ts?raw";

const token = "test-token-that-must-never-be-exposed";
const owner = "sejun7976-coder";
const projectManagerUrl = "https://sejun7976-coder.github.io/Team_Rocket";

function validInput(overrides: Partial<GitHubConfigurationInput> = {}): GitHubConfigurationInput {
  return {
    token,
    owner,
    ownerType: "user",
    projectManagerUrl,
    hosted: true,
    ...overrides
  };
}

function expectConfigurationCode(input: GitHubConfigurationInput, code: string): void {
  try {
    resolveGitHubConfiguration(input);
    throw new Error("configuration should have failed");
  } catch (error) {
    expect(error).toBeInstanceOf(GitHubConfigurationError);
    expect((error as GitHubConfigurationError).code).toBe(code);
    expect((error as Error).message).not.toContain(token);
    expect((error as Error).message).not.toContain(owner);
  }
}

describe("GitHub Edge configuration", () => {
  it("distinguishes a missing or blank token without enforcing a PAT prefix", () => {
    expectConfigurationCode(validInput({ token: undefined }), "GITHUB_TOKEN_MISSING");
    expectConfigurationCode(validInput({ token: "   " }), "GITHUB_TOKEN_MISSING");
    expect(resolveGitHubConfiguration(validInput({ token: "arbitrary-nonempty-token" })).token)
      .toBe("arbitrary-nonempty-token");
  });

  it("distinguishes a missing owner", () => {
    expectConfigurationCode(validInput({ owner: undefined }), "GITHUB_OWNER_MISSING");
    expectConfigurationCode(validInput({ owner: "  " }), "GITHUB_OWNER_MISSING");
  });

  it("accepts the configured Hosted username and other valid GitHub usernames", () => {
    for (const username of ["sejun7976-coder", "username", "user123", "a-b"]) {
      expect(GITHUB_USER_PATTERN.test(username), username).toBe(true);
    }
    expect(resolveGitHubConfiguration(validInput()).owner).toBe(owner);
  });

  it("rejects invalid GitHub usernames with a specific code", () => {
    for (const username of ["-username", "username-", "user--name", "", "a".repeat(40)]) {
      expect(GITHUB_USER_PATTERN.test(username), username).toBe(false);
      if (username) expectConfigurationCode(validInput({ owner: username }), "GITHUB_OWNER_INVALID");
    }
  });

  it("accepts exact lowercase user and organization owner types", () => {
    expect(resolveGitHubConfiguration(validInput({ ownerType: "user" })).ownerType).toBe("user");
    expect(resolveGitHubConfiguration(validInput({ ownerType: "organization" })).ownerType).toBe("organization");
  });

  it("rejects uppercase or unknown owner types", () => {
    expectConfigurationCode(validInput({ ownerType: "USER" }), "GITHUB_OWNER_TYPE_INVALID");
    expectConfigurationCode(validInput({ ownerType: "team" }), "GITHUB_OWNER_TYPE_INVALID");
  });

  it("defaults an absent owner type to user but rejects an explicitly blank value", () => {
    expect(resolveGitHubConfiguration(validInput({ ownerType: undefined })).ownerType).toBe("user");
    expectConfigurationCode(validInput({ ownerType: "  " }), "GITHUB_OWNER_TYPE_INVALID");
  });

  it("identifies the Hosted marker URL condition independently", () => {
    expectConfigurationCode(validInput({ projectManagerUrl: undefined }), "PROJECT_MANAGER_URL_MISSING");
    expectConfigurationCode(validInput({ projectManagerUrl: "http://example.com" }), "PROJECT_MANAGER_URL_INVALID");
  });

  it("keeps the safe localhost marker default only outside Hosted", () => {
    expect(resolveGitHubConfiguration(validInput({ hosted: false, projectManagerUrl: undefined })).projectManagerUrl)
      .toBe("http://127.0.0.1:3000");
  });

  it("runs owner verification after configuration succeeds", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return new Response(JSON.stringify({ login: owner }), { status: 200 });
    });
    const client = new GitHubClient(resolveGitHubConfiguration(validInput()), fetcher);
    await client.verifyConfiguredOwner();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://api.github.com/user");
  });

  it("emits only boolean configuration diagnostics", () => {
    const diagnostic = githubConfigurationDiagnostic(validInput());
    expect(diagnostic).toEqual({
      tokenPresent: true,
      ownerPresent: true,
      ownerValid: true,
      ownerTypeValid: true,
      projectManagerUrlPresent: true,
      projectManagerUrlValid: true
    });
    const serialized = JSON.stringify(diagnostic);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(owner);
    expect(githubSource).toContain('event: "github_configuration_check"');
    expect(githubSource).toContain("...githubConfigurationDiagnostic(input)");
  });

  it("keeps create and retry on the same shared idempotent repository flow", () => {
    for (const source of [createProjectSource, githubRetrySource]) {
      expect(source).toContain('from "../_shared/github.ts"');
      const verify = source.indexOf("await verifyConfiguredOwner()");
      const ensure = source.indexOf("await ensureProjectRepository(");
      const finalize = source.indexOf('admin.rpc("finalize_project_creation"');
      expect(verify).toBeGreaterThan(-1);
      expect(ensure).toBeGreaterThan(verify);
      expect(finalize).toBeGreaterThan(ensure);
      expect(source).not.toContain('Deno.env.get("GITHUB_');
    }
    expect(githubRetrySource.indexOf('status: "synced"')).toBeGreaterThan(
      githubRetrySource.indexOf('admin.rpc("finalize_project_creation"')
    );
  });
});
