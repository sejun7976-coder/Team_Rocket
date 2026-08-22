import { ApiError } from "./http.ts";
import {
  GitHubClient,
  GitHubClientError,
  type GitHubConfiguration,
  type GitHubRepository,
  isRepositoryForProject as matchesProjectRepository
} from "./githubClient.ts";
import {
  GitHubConfigurationError,
  githubConfigurationDiagnostic,
  resolveGitHubConfiguration,
  type GitHubConfigurationInput
} from "./githubConfiguration.ts";
import { GITHUB_USER_PATTERN } from "./validation.ts";

function configuration(): GitHubConfiguration {
  const input: GitHubConfigurationInput = {
    token: Deno.env.get("GITHUB_TOKEN"),
    owner: Deno.env.get("GITHUB_OWNER"),
    ownerType: Deno.env.get("GITHUB_OWNER_TYPE"),
    projectManagerUrl: Deno.env.get("PROJECT_MANAGER_URL"),
    hosted: Boolean(Deno.env.get("DENO_DEPLOYMENT_ID"))
      || Deno.env.get("SUPABASE_URL")?.startsWith("https://") === true
  };
  try {
    return resolveGitHubConfiguration(input);
  } catch (error) {
    console.info(JSON.stringify({
      event: "github_configuration_check",
      ...githubConfigurationDiagnostic(input)
    }));
    if (error instanceof GitHubConfigurationError) {
      throw new ApiError(500, error.code, error.message);
    }
    throw new ApiError(500, "GITHUB_CONFIGURATION_ERROR", "GitHub Edge Function Secret 설정을 확인할 수 없습니다.");
  }
}

function template(): { owner: string; repository: string } | undefined {
  const owner = Deno.env.get("GITHUB_TEMPLATE_OWNER")?.trim();
  const repository = Deno.env.get("GITHUB_TEMPLATE_REPO")?.trim();
  if (!owner && !repository) return undefined;
  if (!owner || !repository || !GITHUB_USER_PATTERN.test(owner)) {
    throw new ApiError(500, "GITHUB_TEMPLATE_CONFIGURATION_ERROR", "GitHub Template Secret 설정이 올바르지 않습니다.");
  }
  return { owner, repository };
}

async function translate<T>(operation: (client: GitHubClient) => Promise<T>): Promise<T> {
  try {
    return await operation(new GitHubClient(configuration()));
  } catch (error) {
    if (error instanceof GitHubClientError) throw new ApiError(error.status, error.code, error.message);
    throw error;
  }
}

export type { GitHubRepository };

export function isRepositoryForProject(repository: GitHubRepository, projectId: string): boolean {
  return matchesProjectRepository(repository, projectId, configuration().projectManagerUrl);
}

export function configuredOwner(): string {
  return configuration().owner;
}

export async function verifyConfiguredOwner(): Promise<void> {
  await translate((client) => client.verifyConfiguredOwner());
}

export async function getRepository(name: string): Promise<GitHubRepository | null> {
  return await translate((client) => client.getRepository(name));
}

export async function createRepository(input: {
  projectId: string;
  name: string;
  description?: string;
  visibility: "private" | "public";
}): Promise<GitHubRepository> {
  return await translate((client) => client.createRepository({ ...input, template: template() }));
}

export async function ensureProjectRepository(input: {
  projectId: string;
  name: string;
  description?: string;
  visibility: "private" | "public";
}): Promise<GitHubRepository> {
  const existing = await getRepository(input.name);
  if (existing) {
    if (!isRepositoryForProject(existing, input.projectId)) {
      throw new ApiError(409, "REPOSITORY_NAME_CONFLICT", "이미 존재하는 Repository 이름입니다.");
    }
    return existing;
  }
  try {
    return await createRepository(input);
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "REPOSITORY_NAME_CONFLICT") throw error;
    const raced = await getRepository(input.name);
    if (raced && isRepositoryForProject(raced, input.projectId)) return raced;
    throw error;
  }
}

export async function addCollaborator(repositoryName: string, username: string): Promise<void> {
  if (!GITHUB_USER_PATTERN.test(username)) throw new ApiError(400, "INVALID_GITHUB_USERNAME", "GitHub username이 올바르지 않습니다.");
  await translate((client) => client.addCollaborator(repositoryName, username));
}

export async function removeCollaborator(repositoryName: string, username: string): Promise<void> {
  if (!GITHUB_USER_PATTERN.test(username)) throw new ApiError(400, "INVALID_GITHUB_USERNAME", "GitHub username이 올바르지 않습니다.");
  await translate((client) => client.removeCollaborator(repositoryName, username));
}

export async function deleteRepository(repositoryName: string): Promise<void> {
  await translate((client) => client.deleteRepository(repositoryName));
}
