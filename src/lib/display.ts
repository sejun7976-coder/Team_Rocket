import type {
  Notification,
  GitHubSyncStatus,
  ProjectRole,
  TaskPriority,
  TaskStatus,
} from "../types/domain";

export const taskStatusLabels: Record<TaskStatus, string> = {
  todo: "할 일",
  in_progress: "진행 중",
  review: "검토",
  done: "완료",
};

export const taskPriorityLabels: Record<TaskPriority, string> = {
  low: "낮음",
  medium: "보통",
  high: "높음",
  urgent: "긴급",
};

export const projectRoleLabels: Record<ProjectRole, string> = {
  owner: "소유자",
  admin: "관리자",
  member: "팀원",
  viewer: "열람자",
};

export const githubSyncStatusLabels: Record<GitHubSyncStatus, string> = {
  pending: "연동 대기 중",
  synced: "연동됨",
  error: "연동 오류",
  not_connected: "연결되지 않음",
};

export function githubErrorMessage(code: string | null): string {
  const messages: Record<string, string> = {
    REPOSITORY_NAME_CONFLICT: "같은 이름의 GitHub 저장소가 이미 있습니다.",
    GITHUB_PERMISSION_DENIED: "GitHub 저장소에 접근할 권한이 없습니다.",
    GITHUB_AUTH_FAILED: "GitHub 연결 인증을 확인해 주세요.",
    GITHUB_REPOSITORY_MISSING: "연결된 GitHub 저장소를 찾을 수 없습니다.",
    GITHUB_NETWORK_FAILED: "GitHub에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    GITHUB_TIMEOUT: "GitHub 응답 시간이 초과되었습니다.",
  };
  return code ? messages[code] ?? "GitHub 저장소 연결 상태를 확인해 주세요." : "GitHub 저장소에 연결하지 못했습니다.";
}

export const notificationTypeLabels: Record<Notification["type"], string> = {
  project_added: "프로젝트 초대",
  task_assigned: "담당자 지정",
  task_unassigned: "담당자 해제",
  mention: "멘션",
  due_soon: "마감 임박",
  task_updated: "작업 변경",
  comment_added: "댓글",
  file_uploaded: "파일",
  overdue: "마감 지연",
};

const activityLabels: Record<string, string> = {
  project_created: "프로젝트를 생성했습니다.",
  member_added: "팀원을 추가했습니다.",
  member_removed: "팀원을 제거했습니다.",
  task_created: "작업을 만들었습니다.",
  task_status_changed: "작업 상태를 변경했습니다.",
  task_progress_changed: "작업 진행률을 변경했습니다.",
  task_due_date_changed: "작업 마감일을 변경했습니다.",
  assignee_added: "담당자를 추가했습니다.",
  assignee_removed: "담당자를 제거했습니다.",
  comment_created: "댓글을 작성했습니다.",
  file_uploaded: "파일을 업로드했습니다.",
  announcement_created: "프로젝트 공지를 작성했습니다.",
  announcement_updated: "프로젝트 공지를 수정했습니다.",
};

export function activityLabel(action: string): string {
  return activityLabels[action] ?? "프로젝트 정보를 변경했습니다.";
}

const activityTargetLabels: Record<string, string> = {
  project: "프로젝트",
  project_announcement: "프로젝트 공지",
  task: "작업",
  assignee: "작업 담당자",
  comment: "댓글",
  file: "프로젝트 파일",
  member: "프로젝트 팀원",
};

export function activityTargetLabel(subjectType: string): string {
  return activityTargetLabels[subjectType] ?? "프로젝트 항목";
}

export function formatRelativeTime(
  value: string,
  now = new Date(),
): string {
  const date = new Date(value);
  const elapsed = now.getTime() - date.getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    return date.toLocaleString("ko-KR");
  }
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "어제";
  if (days < 7) return `${days}일 전`;
  return date.toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
  });
}
