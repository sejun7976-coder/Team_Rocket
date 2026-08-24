export const PERMISSIONS = {
  PROJECTS_VIEW: "projects.view",
  PROJECTS_CREATE: "projects.create",
  PROJECTS_DELETE: "projects.delete",
  USERS_VIEW: "users.view",
  USERS_CREATE: "users.create",
  USERS_DELETE: "users.delete",
  USERS_CHANGE_STATUS: "users.change_status",
  USERS_RESET_PASSWORD: "users.reset_password",
  USERS_CHANGE_ROLE: "users.change_role",
  USERS_MANAGE_PERMISSIONS: "users.manage_permissions",
  ACCESS_LOGS_VIEW: "access_logs.view",
  AI_USE: "ai.use",
  AI_MANAGE: "ai.manage",
  AI_LOGS_VIEW: "ai.logs.view",
} as const;

export type Permission =
  (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export type PermissionCategory = "projects" | "users" | "permissions" | "logs" | "ai";

export interface PermissionDefinition {
  key: Permission;
  category: PermissionCategory;
  label: string;
  description: string;
}

export const PERMISSION_REGISTRY: readonly PermissionDefinition[] = [
  {
    key: PERMISSIONS.PROJECTS_VIEW,
    category: "projects",
    label: "전체 프로젝트 조회",
    description: "관리자 프로젝트 목록과 운영 상태를 조회합니다.",
  },
  {
    key: PERMISSIONS.PROJECTS_CREATE,
    category: "projects",
    label: "프로젝트 생성",
    description: "새 프로젝트와 선택한 GitHub 저장소를 생성합니다.",
  },
  {
    key: PERMISSIONS.PROJECTS_DELETE,
    category: "projects",
    label: "프로젝트 삭제",
    description: "소유한 프로젝트와 연결된 데이터를 영구 삭제합니다.",
  },
  {
    key: PERMISSIONS.USERS_VIEW,
    category: "users",
    label: "사용자 조회",
    description: "관리 대상 사용자와 계정 상태를 조회합니다.",
  },
  {
    key: PERMISSIONS.USERS_CREATE,
    category: "users",
    label: "사용자 생성",
    description: "초기 비밀번호가 설정된 새 사용자 계정을 만듭니다.",
  },
  {
    key: PERMISSIONS.USERS_DELETE,
    category: "users",
    label: "사용자 삭제",
    description: "보호 조건을 확인한 뒤 사용자 계정을 완전히 삭제합니다.",
  },
  {
    key: PERMISSIONS.USERS_CHANGE_STATUS,
    category: "users",
    label: "사용자 활성/비활성",
    description: "사용자의 로그인과 업무 데이터 접근 상태를 변경합니다.",
  },
  {
    key: PERMISSIONS.USERS_RESET_PASSWORD,
    category: "users",
    label: "비밀번호 초기화",
    description: "사용자 비밀번호와 클라이언트 암호화 키 상태를 초기화합니다.",
  },
  {
    key: PERMISSIONS.USERS_CHANGE_ROLE,
    category: "permissions",
    label: "계정 유형 변경",
    description: "관리상 계정 유형을 User 또는 Admin으로 변경합니다.",
  },
  {
    key: PERMISSIONS.USERS_MANAGE_PERMISSIONS,
    category: "permissions",
    label: "기능 권한 설정",
    description: "프로젝트 생성·삭제, 사용자 관리 등 실제 사용할 기능을 설정합니다.",
  },
  {
    key: PERMISSIONS.ACCESS_LOGS_VIEW,
    category: "logs",
    label: "접속 기록 조회",
    description: "사용자의 최근 인증 및 서비스 접속 기록을 조회합니다.",
  },
  {
    key: PERMISSIONS.AI_USE,
    category: "ai",
    label: "AI 사용",
    description: "활성 모델로 프로젝트 AI Assistant를 사용합니다.",
  },
  {
    key: PERMISSIONS.AI_MANAGE,
    category: "ai",
    label: "AI 설정 관리",
    description: "AI 모델 활성화, 기본 모델 지정 및 Gateway 연결을 점검합니다.",
  },
  {
    key: PERMISSIONS.AI_LOGS_VIEW,
    category: "ai",
    label: "AI 대화 기록 조회",
    description: "Admin이 Rocket AI 대화 및 정책 위반 기록을 조회합니다.",
  },
];

export const PERMISSION_KEYS = PERMISSION_REGISTRY.map(
  ({ key }) => key,
) as readonly Permission[];

const PERMISSION_SET = new Set<string>(PERMISSION_KEYS);

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && PERMISSION_SET.has(value);
}

// 이전 이름은 migration/배포 호환성을 위해 alias로만 유지한다.
export const ADMIN_PERMISSIONS = PERMISSIONS;
export const ADMIN_PERMISSION_REGISTRY = PERMISSION_REGISTRY;
export const ADMIN_PERMISSION_KEYS = PERMISSION_KEYS;
export type AdminPermission = Permission;
export type AdminPermissionCategory = PermissionCategory;
export const isAdminPermission = isPermission;
