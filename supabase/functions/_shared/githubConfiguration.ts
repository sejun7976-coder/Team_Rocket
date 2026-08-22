import type { GitHubConfiguration } from "./githubClient.ts";
import { normalizeProjectManagerUrl } from "./githubClient.ts";
import { GITHUB_USER_PATTERN } from "./githubUsername.ts";

export type GitHubConfigurationErrorCode =
  | "GITHUB_TOKEN_MISSING"
  | "GITHUB_OWNER_MISSING"
  | "GITHUB_OWNER_INVALID"
  | "GITHUB_OWNER_TYPE_INVALID"
  | "PROJECT_MANAGER_URL_MISSING"
  | "PROJECT_MANAGER_URL_INVALID";

export interface GitHubConfigurationInput {
  token: string | undefined;
  owner: string | undefined;
  ownerType: string | undefined;
  projectManagerUrl: string | undefined;
  hosted: boolean;
}

export interface GitHubConfigurationDiagnostic {
  tokenPresent: boolean;
  ownerPresent: boolean;
  ownerValid: boolean;
  ownerTypeValid: boolean;
  projectManagerUrlPresent: boolean;
  projectManagerUrlValid: boolean;
}

export class GitHubConfigurationError extends Error {
  constructor(public readonly code: GitHubConfigurationErrorCode, message: string) {
    super(message);
    this.name = "GitHubConfigurationError";
  }
}

function normalized(input: GitHubConfigurationInput) {
  const token = input.token?.trim() ?? "";
  const owner = input.owner?.trim() ?? "";
  const ownerType = input.ownerType === undefined ? "user" : input.ownerType.trim();
  const configuredProjectManagerUrl = input.projectManagerUrl?.trim() ?? "";
  const projectManagerUrl = normalizeProjectManagerUrl(
    configuredProjectManagerUrl || (input.hosted ? "" : "http://127.0.0.1:3000")
  );
  return { token, owner, ownerType, configuredProjectManagerUrl, projectManagerUrl };
}

export function githubConfigurationDiagnostic(input: GitHubConfigurationInput): GitHubConfigurationDiagnostic {
  const values = normalized(input);
  return {
    tokenPresent: values.token.length > 0,
    ownerPresent: values.owner.length > 0,
    ownerValid: values.owner.length > 0 && GITHUB_USER_PATTERN.test(values.owner),
    ownerTypeValid: values.ownerType === "user" || values.ownerType === "organization",
    projectManagerUrlPresent: values.configuredProjectManagerUrl.length > 0,
    projectManagerUrlValid: values.projectManagerUrl !== null
      && (!input.hosted || values.projectManagerUrl.startsWith("https://"))
  };
}

export function resolveGitHubConfiguration(input: GitHubConfigurationInput): GitHubConfiguration {
  const values = normalized(input);
  if (!values.token) {
    throw new GitHubConfigurationError("GITHUB_TOKEN_MISSING", "GitHub token Secret이 설정되지 않았습니다.");
  }
  if (!values.owner) {
    throw new GitHubConfigurationError("GITHUB_OWNER_MISSING", "GitHub Owner Secret이 설정되지 않았습니다.");
  }
  if (!GITHUB_USER_PATTERN.test(values.owner)) {
    throw new GitHubConfigurationError("GITHUB_OWNER_INVALID", "GitHub Owner 형식이 올바르지 않습니다.");
  }
  if (values.ownerType !== "user" && values.ownerType !== "organization") {
    throw new GitHubConfigurationError("GITHUB_OWNER_TYPE_INVALID", "GitHub Owner Type이 올바르지 않습니다.");
  }
  if (input.hosted && !values.configuredProjectManagerUrl) {
    throw new GitHubConfigurationError("PROJECT_MANAGER_URL_MISSING", "프로젝트 관리 사이트 URL Secret이 설정되지 않았습니다.");
  }
  if (!values.projectManagerUrl || (input.hosted && !values.projectManagerUrl.startsWith("https://"))) {
    throw new GitHubConfigurationError("PROJECT_MANAGER_URL_INVALID", "프로젝트 관리 사이트 URL이 올바르지 않습니다.");
  }
  return {
    token: values.token,
    owner: values.owner,
    ownerType: values.ownerType,
    projectManagerUrl: values.projectManagerUrl
  };
}
