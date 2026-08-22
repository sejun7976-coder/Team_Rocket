const API = "https://api.github.com";
const API_VERSION = "2022-11-28";
const DEFAULT_TIMEOUT_MS = 12_000;

export type GitHubOwnerType = "user" | "organization";

export interface GitHubConfiguration {
  token: string;
  owner: string;
  ownerType: GitHubOwnerType;
  projectManagerUrl: string;
}

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  private: boolean;
  homepage: string | null;
}

export interface GitHubCommitSummary { sha: string; message: string; authoredAt: string | null }

export interface CreateGitHubRepositoryInput {
  projectId: string;
  name: string;
  description?: string;
  visibility: "private" | "public";
  template?: { owner: string; repository: string };
}

export class GitHubClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function responseError(response: Response): GitHubClientError {
  if (response.status === 401) return new GitHubClientError(502, "GITHUB_AUTH_FAILED", "GitHub 인증에 실패했습니다.");
  if ((response.status === 403 || response.status === 429) && response.headers.get("X-RateLimit-Remaining") === "0") {
    return new GitHubClientError(429, "GITHUB_RATE_LIMIT", "GitHub 요청 한도에 도달했습니다.");
  }
  if (response.status === 403) return new GitHubClientError(502, "GITHUB_PERMISSION_DENIED", "GitHub 권한이 요청을 거부했습니다.");
  if (response.status === 404) return new GitHubClientError(404, "GITHUB_NOT_FOUND", "GitHub 리소스를 찾을 수 없습니다.");
  if (response.status === 409 || response.status === 422) {
    return new GitHubClientError(409, "REPOSITORY_NAME_CONFLICT", "이미 존재하거나 사용할 수 없는 Repository 이름입니다.");
  }
  if (response.status === 410) return new GitHubClientError(502, "GITHUB_API_VERSION_UNSUPPORTED", "GitHub API version을 갱신해야 합니다.");
  if (response.status === 429) return new GitHubClientError(429, "GITHUB_RATE_LIMIT", "GitHub 요청 한도에 도달했습니다.");
  return new GitHubClientError(502, "GITHUB_API_FAILED", "GitHub 요청을 완료할 수 없습니다.");
}

function parseRepository(value: unknown): GitHubRepository {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GitHubClientError(502, "GITHUB_INVALID_RESPONSE", "GitHub 응답이 올바르지 않습니다.");
  }
  const repository = value as Record<string, unknown>;
  if (
    typeof repository.id !== "number" || !Number.isSafeInteger(repository.id) || repository.id <= 0
    || typeof repository.name !== "string" || repository.name.length === 0
    || typeof repository.full_name !== "string" || !repository.full_name.includes("/")
    || typeof repository.html_url !== "string" || !repository.html_url.startsWith("https://github.com/")
    || typeof repository.private !== "boolean"
    || (repository.homepage !== null && typeof repository.homepage !== "string")
  ) {
    throw new GitHubClientError(502, "GITHUB_INVALID_RESPONSE", "GitHub 응답이 올바르지 않습니다.");
  }
  return repository as unknown as GitHubRepository;
}

export function normalizeProjectManagerUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const localHttp = url.protocol === "http:"
      && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !localHttp) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    const pathname = url.pathname.replace(/\/+$/u, "");
    return `${url.origin}${pathname}`;
  } catch {
    return null;
  }
}

export function projectRepositoryMarker(projectManagerUrl: string, projectId: string): string {
  return `${projectManagerUrl}/#/projects/${projectId}`;
}

export function legacyProjectRepositoryMarker(projectId: string): string {
  return `https://rocket-campus.invalid/projects/${projectId}`;
}

export type RepositoryMarkerStatus = "canonical" | "legacy" | "missing" | "mismatch";
export function repositoryMarkerStatus(repository: GitHubRepository, projectId: string, projectManagerUrl: string): RepositoryMarkerStatus {
  if (repository.homepage === projectRepositoryMarker(projectManagerUrl, projectId)) return "canonical";
  if (repository.homepage === legacyProjectRepositoryMarker(projectId)) return "legacy";
  if (!repository.homepage?.trim()) return "missing";
  return "mismatch";
}

export function isRepositoryForProject(repository: GitHubRepository, projectId: string, projectManagerUrl: string): boolean {
  return repository.homepage === projectRepositoryMarker(projectManagerUrl, projectId);
}

export class GitHubClient {
  constructor(
    private readonly configuration: GitHubConfiguration,
    private readonly fetcher: Fetcher = fetch,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS
  ) {}

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/vnd.github+json");
    headers.set("Authorization", `Bearer ${this.configuration.token}`);
    headers.set("X-GitHub-Api-Version", API_VERSION);
    headers.set("User-Agent", "rocket-campus-supabase-function");
    try {
      return await this.fetcher(`${API}${path}`, { ...init, headers, signal: controller.signal });
    } catch {
      if (controller.signal.aborted) throw new GitHubClientError(504, "GITHUB_TIMEOUT", "GitHub 응답 시간이 초과되었습니다.");
      throw new GitHubClientError(502, "GITHUB_NETWORK_FAILED", "GitHub에 연결할 수 없습니다.");
    } finally {
      clearTimeout(timeout);
    }
  }

  private async json(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new GitHubClientError(502, "GITHUB_INVALID_RESPONSE", "GitHub 응답이 올바르지 않습니다.");
    }
  }

  private assertRepositoryOwner(repository: GitHubRepository): void {
    const repositoryOwner = repository.full_name.split("/", 1)[0];
    if (repositoryOwner?.toLowerCase() !== this.configuration.owner.toLowerCase()) {
      throw new GitHubClientError(502, "GITHUB_OWNER_MISMATCH", "GitHub token과 Repository Owner 설정이 일치하지 않습니다.");
    }
  }

  async verifyConfiguredOwner(): Promise<void> {
    const path = this.configuration.ownerType === "user"
      ? "/user"
      : `/orgs/${encodeURIComponent(this.configuration.owner)}`;
    const response = await this.request(path);
    if (!response.ok) throw responseError(response);
    const value = await this.json(response);
    const login = value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>).login
      : undefined;
    if (typeof login !== "string" || login.toLowerCase() !== this.configuration.owner.toLowerCase()) {
      throw new GitHubClientError(502, "GITHUB_OWNER_MISMATCH", "GitHub token과 Repository Owner 설정이 일치하지 않습니다.");
    }
  }

  async getRepository(name: string): Promise<GitHubRepository | null> {
    const response = await this.request(`/repos/${encodeURIComponent(this.configuration.owner)}/${encodeURIComponent(name)}`);
    if (response.status === 404) return null;
    if (!response.ok) throw responseError(response);
    const repository = parseRepository(await this.json(response));
    this.assertRepositoryOwner(repository);
    return repository;
  }

  async setRepositoryHomepage(name: string, homepage: string): Promise<GitHubRepository> {
    const response = await this.request(
      `/repos/${encodeURIComponent(this.configuration.owner)}/${encodeURIComponent(name)}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ homepage }) }
    );
    if (!response.ok) throw responseError(response);
    const repository = parseRepository(await this.json(response));
    this.assertRepositoryOwner(repository);
    return repository;
  }

  async createRepository(input: CreateGitHubRepositoryInput): Promise<GitHubRepository> {
    const marker = projectRepositoryMarker(this.configuration.projectManagerUrl, input.projectId);
    let path: string;
    let payload: Record<string, unknown>;
    if (input.template) {
      path = `/repos/${encodeURIComponent(input.template.owner)}/${encodeURIComponent(input.template.repository)}/generate`;
      payload = {
        owner: this.configuration.owner,
        name: input.name,
        description: input.description ?? "",
        private: input.visibility === "private",
        include_all_branches: false
      };
    } else {
      path = this.configuration.ownerType === "organization"
        ? `/orgs/${encodeURIComponent(this.configuration.owner)}/repos`
        : "/user/repos";
      payload = {
        name: input.name,
        description: input.description ?? "",
        private: input.visibility === "private",
        auto_init: true,
        homepage: marker
      };
    }

    const response = await this.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw responseError(response);
    let repository = parseRepository(await this.json(response));
    this.assertRepositoryOwner(repository);

    if (input.template && repository.homepage !== marker) {
      const markerResponse = await this.request(
        `/repos/${encodeURIComponent(this.configuration.owner)}/${encodeURIComponent(repository.name)}`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ homepage: marker }) }
      );
      if (!markerResponse.ok) throw responseError(markerResponse);
      repository = parseRepository(await this.json(markerResponse));
      this.assertRepositoryOwner(repository);
    }
    return repository;
  }

  async addCollaborator(repositoryName: string, username: string): Promise<void> {
    const response = await this.request(
      `/repos/${encodeURIComponent(this.configuration.owner)}/${encodeURIComponent(repositoryName)}/collaborators/${encodeURIComponent(username)}`,
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ permission: "push" }) }
    );
    if (!response.ok) throw responseError(response);
  }

  async removeCollaborator(repositoryName: string, username: string): Promise<void> {
    const response = await this.request(
      `/repos/${encodeURIComponent(this.configuration.owner)}/${encodeURIComponent(repositoryName)}/collaborators/${encodeURIComponent(username)}`,
      { method: "DELETE" }
    );
    if (!response.ok && response.status !== 404) throw responseError(response);
  }

  async deleteRepository(repositoryName: string): Promise<void> {
    const response = await this.request(
      `/repos/${encodeURIComponent(this.configuration.owner)}/${encodeURIComponent(repositoryName)}`,
      { method: "DELETE" }
    );
    if (!response.ok && response.status !== 404) throw responseError(response);
  }

  async listRecentCommits(repositoryName: string): Promise<GitHubCommitSummary[]> {
    const response = await this.request(`/repos/${encodeURIComponent(this.configuration.owner)}/${encodeURIComponent(repositoryName)}/commits?per_page=10`);
    if (response.status === 404 || response.status === 409) return [];
    if (!response.ok) throw responseError(response);
    const value = await this.json(response);
    if (!Array.isArray(value)) throw new GitHubClientError(502, "GITHUB_INVALID_RESPONSE", "GitHub 응답이 올바르지 않습니다.");
    return value.flatMap((item): GitHubCommitSummary[] => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      const commit = record.commit && typeof record.commit === "object" && !Array.isArray(record.commit) ? record.commit as Record<string, unknown> : null;
      const author = commit?.author && typeof commit.author === "object" && !Array.isArray(commit.author) ? commit.author as Record<string, unknown> : null;
      if (typeof record.sha !== "string" || typeof commit?.message !== "string") return [];
      return [{ sha: record.sha.slice(0, 12), message: commit.message.slice(0, 500), authoredAt: typeof author?.date === "string" ? author.date : null }];
    });
  }
}
