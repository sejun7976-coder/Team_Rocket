import { createProjectKey, wrapExistingProjectKey } from "../crypto";
import { invokeAuthenticatedFunction } from "../lib/authenticatedFunction";
import { supabase } from "../lib/supabase";
import type { Profile, Project, ProjectMember, ProjectRole } from "../types/domain";
import { useAuthStore } from "../stores/authStore";
import { useProjectKeyStore } from "../stores/projectKeyStore";

export async function listProjects(): Promise<Project[]> {
  const { data, error } = await supabase.from("projects")
    .select("*, project_members!inner(user_id, role), tasks(id, status, task_assignees(user_id))")
    .is("archived_at", null)
    .order("updated_at", { ascending: false });
  if (error) throw new Error("프로젝트 목록을 불러올 수 없습니다.");
  return (data ?? []) as unknown as Project[];
}

export interface CreateProjectInput {
  name: string;
  description?: string | undefined;
  repositoryName: string;
  visibility: "private" | "public";
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const { user, profile } = useAuthStore.getState();
  if (!user || !profile?.encryption_public_key) throw new Error("사용자 암호화 keyring을 먼저 설정하세요.");
  const projectId = crypto.randomUUID();
  const idempotencyKey = crypto.randomUUID();
  const generated = await createProjectKey(profile.encryption_public_key, projectId, user.id);
  const data = await invokeAuthenticatedFunction<{ project: Project }>("create-project", {
    headers: { "X-Idempotency-Key": idempotencyKey },
    body: {
      ...input,
      projectId,
      idempotencyKey,
      ownerKeyEnvelope: {
        wrappedKey: generated.wrapped.wrappedKey,
        ephemeralPublicKey: generated.wrapped.ephemeralPublicKey
      }
    },
    fallbackMessage: "프로젝트를 생성할 수 없습니다."
  });
  useProjectKeyStore.getState().remember(projectId, generated.projectKey);
  return data.project;
}

export async function getProject(projectId: string): Promise<Project> {
  const { data, error } = await supabase.from("projects").select("*").eq("id", projectId).single();
  if (error || !data) throw new Error("프로젝트를 찾을 수 없거나 접근 권한이 없습니다.");
  return data as Project;
}

export async function listProjectMembers(projectId: string): Promise<ProjectMember[]> {
  const { data, error } = await supabase.from("project_members").select(
    "*, profile:profiles!project_members_user_id_fkey(id, student_id, name, github_username, avatar_url, encryption_public_key)"
  ).eq("project_id", projectId).order("created_at");
  if (error) throw new Error("팀원 목록을 불러올 수 없습니다.");
  return (data ?? []) as unknown as ProjectMember[];
}

export async function searchProfiles(query: string): Promise<Profile[]> {
  if (query.trim().length < 2) return [];
  const { data, error } = await supabase.rpc("search_profiles", { p_query: query.trim(), p_limit: 20 });
  if (error) throw new Error("사용자를 검색할 수 없습니다.");
  return (data ?? []) as Profile[];
}

export async function addProjectMember(
  projectId: string,
  target: Pick<Profile, "id" | "encryption_public_key">,
  role: Exclude<ProjectRole, "owner">
): Promise<ProjectMember> {
  if (!target.encryption_public_key) throw new Error("대상 사용자의 암호화 keyring이 아직 설정되지 않았습니다.");
  const projectKey = await useProjectKeyStore.getState().unlock(projectId);
  const wrapped = await wrapExistingProjectKey(projectKey, target.encryption_public_key, projectId, target.id);
  const data = await invokeAuthenticatedFunction<{ member: ProjectMember }>("sync-project-member", {
    body: {
      projectId,
      userId: target.id,
      role,
      wrappedKey: wrapped.wrappedKey,
      ephemeralPublicKey: wrapped.ephemeralPublicKey
    },
    fallbackMessage: "팀원을 추가할 수 없습니다."
  });
  return data.member;
}

export async function rewrapProjectMemberKey(projectId: string, target: Pick<Profile, "id" | "encryption_public_key">): Promise<void> {
  if (!target.encryption_public_key) throw new Error("대상 사용자가 비밀번호 변경과 keyring 설정을 먼저 완료해야 합니다.");
  const projectKey = await useProjectKeyStore.getState().unlock(projectId);
  const wrapped = await wrapExistingProjectKey(projectKey, target.encryption_public_key, projectId, target.id);
  await invokeAuthenticatedFunction("sync-project-member", {
    body: {
      projectId,
      userId: target.id,
      role: "member",
      preserveMembership: true,
      wrappedKey: wrapped.wrappedKey,
      ephemeralPublicKey: wrapped.ephemeralPublicKey
    },
    fallbackMessage: "프로젝트 암호화 키를 다시 공유할 수 없습니다."
  });
}

export async function removeProjectMember(projectId: string, userId: string): Promise<{ githubSyncStatus: string; githubErrorCode: string | null }> {
  return invokeAuthenticatedFunction("remove-project-member", {
    body: { projectId, userId },
    fallbackMessage: "팀원을 제거할 수 없습니다."
  });
}

export async function updateProject(projectId: string, updates: Partial<Pick<Project, "name" | "description" | "github_auto_sync" | "status">>): Promise<Project> {
  const { data, error } = await supabase.from("projects").update(updates).eq("id", projectId).select().single();
  if (error || !data) throw new Error("프로젝트를 수정할 권한이 없습니다.");
  return data as Project;
}

export async function deleteGitHubRepository(projectId: string, confirmation: string): Promise<void> {
  await invokeAuthenticatedFunction("delete-github-repository", {
    body: { projectId, confirmation },
    fallbackMessage: "GitHub Repository를 삭제할 수 없습니다."
  });
}

export async function retryGitHubMemberSync(projectId: string, userId: string, action: "add_collaborator" | "remove_collaborator"): Promise<void> {
  await invokeAuthenticatedFunction("github-retry", {
    body: { projectId, userId, action },
    fallbackMessage: "GitHub 동기화를 재시도할 수 없습니다."
  });
}

export async function retryGitHubRepositoryCreation(projectId: string): Promise<Project> {
  const data = await invokeAuthenticatedFunction<{ project: Project }>("github-retry", {
    body: { projectId, action: "create_repository" },
    fallbackMessage: "GitHub Repository 생성을 재시도할 수 없습니다."
  });
  return data.project;
}
