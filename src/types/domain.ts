import type { EncryptionEnvelope } from "../crypto";

export type ProjectRole = "owner" | "admin" | "member" | "viewer";
export type ProjectStatus = "creating" | "active" | "error" | "archived";
export type GitHubSyncStatus = "pending" | "synced" | "error" | "not_connected";
export type TaskStatus = "todo" | "in_progress" | "review" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type ProgressMode = "manual" | "checklist";
export type SystemRole = "user" | "admin";
export type AccountStatus = "password_change_required" | "active" | "inactive";

export interface Profile {
  id: string;
  student_id: string;
  name: string;
  github_username: string | null;
  avatar_url: string | null;
  encryption_public_key: JsonWebKey | null;
  encrypted_private_key: EncryptionEnvelope | null;
  key_salt: string | null;
  key_kdf_iterations: number;
  system_role: SystemRole;
  account_status: AccountStatus;
  created_by: string | null;
  first_login_completed_at: string | null;
  password_changed_at: string | null;
  key_reset_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectMember {
  project_id: string;
  user_id: string;
  role: ProjectRole;
  github_sync_status: GitHubSyncStatus;
  github_error_code: string | null;
  created_at: string;
  added_by: string | null;
  profile?: Pick<
    Profile,
    | "id"
    | "student_id"
    | "name"
    | "github_username"
    | "avatar_url"
    | "encryption_public_key"
  >;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  note_encrypted: EncryptionEnvelope | null;
  created_by: string;
  status: ProjectStatus;
  visibility: "private" | "public";
  github_repository_id: number | null;
  github_owner: string | null;
  github_repository_name: string;
  github_repository_url: string | null;
  github_sync_status: GitHubSyncStatus;
  github_error_code: string | null;
  github_auto_sync: boolean;
  revision: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  project_members?: Array<Pick<ProjectMember, "user_id" | "role">>;
  tasks?: Array<
    Pick<Task, "id" | "status"> & {
      task_assignees?: Array<{ user_id: string }>;
    }
  >;
}

export interface TaskAssignee {
  task_id: string;
  user_id: string;
  assigned_by: string | null;
  created_at: string;
  profile?: Pick<Profile, "id" | "student_id" | "name" | "avatar_url">;
}

export interface ChecklistItem {
  id: string;
  task_id: string;
  content_encrypted: EncryptionEnvelope;
  content?: string;
  completed: boolean;
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description_encrypted: EncryptionEnvelope | null;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  progress: number;
  progress_mode: ProgressMode;
  start_date: string | null;
  due_date: string | null;
  created_by: string | null;
  revision: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  task_assignees?: TaskAssignee[];
  task_checklist_items?: ChecklistItem[];
  comments?: Array<{ count: number }>;
  files?: Array<{ count: number }>;
}

export interface Comment {
  id: string;
  task_id: string;
  author_id: string | null;
  content_encrypted: EncryptionEnvelope;
  content?: string;
  revision: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  author?: Pick<Profile, "id" | "name" | "student_id" | "avatar_url">;
}

export interface Activity {
  id: string;
  project_id: string;
  actor_id: string | null;
  action: string;
  subject_type: string;
  subject_id: string | null;
  payload_encrypted: EncryptionEnvelope | null;
  created_at: string;
  actor?: Pick<Profile, "id" | "name" | "avatar_url">;
  project?: Pick<Project, "id" | "name">;
}

export interface ProjectAnnouncement {
  project_id: string;
  content_encrypted: EncryptionEnvelope;
  content: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  updater?: Pick<Profile, "id" | "name" | "student_id" | "avatar_url"> | null;
}

export interface ProjectFile {
  id: string;
  project_id: string;
  task_id: string | null;
  folder_id: string | null;
  storage_path: string;
  original_name_encrypted: EncryptionEnvelope;
  filename?: string;
  mime_type: string;
  original_size: number;
  encrypted_size: number;
  chunk_count: number;
  checksum_encrypted: EncryptionEnvelope;
  uploaded_by: string | null;
  deleted_at: string | null;
  created_at: string;
  uploader?: Pick<Profile, "id" | "name" | "avatar_url">;
  task?: Pick<Task, "id" | "title"> | null;
}

export interface FileFolder {
  id: string;
  project_id: string;
  name_encrypted: EncryptionEnvelope;
  name?: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  project_id: string | null;
  task_id: string | null;
  type:
    | "project_added"
    | "task_assigned"
    | "task_unassigned"
    | "mention"
    | "due_soon"
    | "task_updated"
    | "comment_added"
    | "file_uploaded"
    | "overdue";
  title: string;
  read_at: string | null;
  created_at: string;
}
