import { describe, expect, it, vi } from "vitest";
import {
  GitHubClient,
  GitHubClientError,
  isRepositoryForProject,
  legacyProjectRepositoryMarker,
  normalizeProjectManagerUrl,
  projectRepositoryMarker,
  repositoryMarkerStatus
} from "../../supabase/functions/_shared/githubClient.ts";

const projectId = "10000000-0000-4000-8000-000000000001";
const owner = "sejun7976-coder";
const fakeToken = "unit-test-token-not-a-secret";
const projectManagerUrl = "https://sejun7976-coder.github.io/Team_Rocket";

function repository(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 123456,
    name: "ai-pilot",
    full_name: `${owner}/ai-pilot`,
    html_url: `https://github.com/${owner}/ai-pilot`,
    private: true,
    homepage: projectRepositoryMarker(projectManagerUrl, projectId),
    ...overrides
  };
}

describe("GitHub Repository client", () => {
  it("verifies the token owner and creates an initialized private user repository", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/user")) return new Response(JSON.stringify({ login: owner }), { status: 200 });
      if (url.endsWith("/user/repos") && init?.method === "POST") {
        return new Response(JSON.stringify(repository()), { status: 201 });
      }
      return new Response(null, { status: 500 });
    });
    const client = new GitHubClient({ token: fakeToken, owner, ownerType: "user", projectManagerUrl }, fetcher);

    await client.verifyConfiguredOwner();
    const created = await client.createRepository({
      projectId,
      name: "ai-pilot",
      description: "AI Pilot",
      visibility: "private"
    });

    expect(created.full_name).toBe(`${owner}/ai-pilot`);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const createCall = fetcher.mock.calls[1];
    expect(String(createCall?.[0])).toBe("https://api.github.com/user/repos");
    const request = createCall?.[1];
    const payload = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(payload).toEqual(expect.objectContaining({
      name: "ai-pilot",
      private: true,
      auto_init: true,
      homepage: projectRepositoryMarker(projectManagerUrl, projectId)
    }));
    const headers = new Headers(request?.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${fakeToken}`);
    expect(headers.get("X-GitHub-Api-Version")).toBe("2022-11-28");
  });

  it("rejects a token whose authenticated user differs from GITHUB_OWNER without exposing the token", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ login: "different-owner" }), { status: 200 }));
    const client = new GitHubClient({ token: fakeToken, owner, ownerType: "user", projectManagerUrl }, fetcher);

    try {
      await client.verifyConfiguredOwner();
      throw new Error("verification should have failed");
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubClientError);
      expect((error as GitHubClientError).code).toBe("GITHUB_OWNER_MISMATCH");
      expect((error as Error).message).not.toContain(fakeToken);
    }
  });

  it("maps GitHub GET /user 401 to GITHUB_AUTH_FAILED", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 401 }));
    const client = new GitHubClient({ token: fakeToken, owner, ownerType: "user", projectManagerUrl }, fetcher);

    await expect(client.verifyConfiguredOwner()).rejects.toMatchObject({
      status: 502,
      code: "GITHUB_AUTH_FAILED"
    });
  });

  it("returns null only for an actual repository 404", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 404 }));
    const client = new GitHubClient({ token: fakeToken, owner, ownerType: "user", projectManagerUrl }, fetcher);

    await expect(client.getRepository("missing-repository")).resolves.toBeNull();
  });

  it("keeps repository permission failures distinct from missing repositories", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 403 }));
    const client = new GitHubClient({ token: fakeToken, owner, ownerType: "user", projectManagerUrl }, fetcher);

    await expect(client.getRepository("private-repository")).rejects.toMatchObject({
      status: 502,
      code: "GITHUB_PERMISSION_DENIED"
    });
  });

  it("recognizes only repositories carrying the matching project idempotency marker", () => {
    const matching = repository();
    const different = repository({ homepage: projectRepositoryMarker(projectManagerUrl, "20000000-0000-4000-8000-000000000001") });
    expect(isRepositoryForProject(matching as never, projectId, projectManagerUrl)).toBe(true);
    expect(isRepositoryForProject(different as never, projectId, projectManagerUrl)).toBe(false);
  });

  it("classifies canonical, same-project legacy, missing, and mismatched markers without cross-project claiming", () => {
    const otherProjectId = "20000000-0000-4000-8000-000000000001";
    expect(repositoryMarkerStatus(repository() as never, projectId, projectManagerUrl)).toBe("canonical");
    expect(repositoryMarkerStatus(repository({ homepage: legacyProjectRepositoryMarker(projectId) }) as never, projectId, projectManagerUrl)).toBe("legacy");
    expect(repositoryMarkerStatus(repository({ homepage: null }) as never, projectId, projectManagerUrl)).toBe("missing");
    expect(repositoryMarkerStatus(repository({ homepage: legacyProjectRepositoryMarker(otherProjectId) }) as never, projectId, projectManagerUrl)).toBe("mismatch");
  });

  it("patches a legacy homepage to the canonical project marker", async () => {
    const canonical = projectRepositoryMarker(projectManagerUrl, projectId);
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify(repository({ homepage: payload.homepage })), { status: 200 });
    });
    const client = new GitHubClient({ token: fakeToken, owner, ownerType: "user", projectManagerUrl }, fetcher);

    const upgraded = await client.setRepositoryHomepage("ai-pilot", canonical);

    expect(upgraded.homepage).toBe(canonical);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(`https://api.github.com/repos/${owner}/ai-pilot`);
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe("PATCH");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ homepage: canonical });
  });

  it("maps GitHub rate-limit responses to a stable safe error code", async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      status: 403,
      headers: { "X-RateLimit-Remaining": "0" }
    }));
    const client = new GitHubClient({ token: fakeToken, owner, ownerType: "user", projectManagerUrl }, fetcher);

    await expect(client.getRepository("ai-pilot")).rejects.toMatchObject({
      status: 429,
      code: "GITHUB_RATE_LIMIT"
    });
  });

  it("adds the project marker after generating from an optional template", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify(repository({ homepage: null })), { status: 201 });
      }
      if (init?.method === "PATCH") {
        return new Response(JSON.stringify(repository()), { status: 200 });
      }
      return new Response(null, { status: 500 });
    });
    const client = new GitHubClient({ token: fakeToken, owner, ownerType: "user", projectManagerUrl }, fetcher);

    const created = await client.createRepository({
      projectId,
      name: "ai-pilot",
      visibility: "private",
      template: { owner: "template-owner", repository: "starter" }
    });

    expect(created.homepage).toBe(projectRepositoryMarker(projectManagerUrl, projectId));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1]?.[0])).toBe(`https://api.github.com/repos/${owner}/ai-pilot`);
  });

  it("normalizes the configured site URL and rejects unsafe production marker bases", () => {
    expect(normalizeProjectManagerUrl(`${projectManagerUrl}/`)).toBe(projectManagerUrl);
    expect(normalizeProjectManagerUrl("http://127.0.0.1:3000/")).toBe("http://127.0.0.1:3000");
    expect(normalizeProjectManagerUrl("http://example.com/Team_Rocket")).toBeNull();
    expect(normalizeProjectManagerUrl("https://example.com/Team_Rocket?token=secret")).toBeNull();
  });
});
