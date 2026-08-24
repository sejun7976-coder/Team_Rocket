import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FolderKanban,
  History,
  KeyRound,
  MoreVertical,
  Plus,
  Settings2,
  Shield,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Popover,
  Spinner,
  useToast,
} from "../components/ui";
import {
  createAdminUser,
  deleteAdminUser,
  listAdminAccessLogs,
  listAdminProjects,
  listAdminUsers,
  resetAdminUserPassword,
  setAdminUserActive,
  setUserPermissions,
  setAdminUserRole,
  type AdminUser,
  type AdminUserStatus,
  type AccessLogEventType,
} from "../services/admin";
import { useAuthStore } from "../stores/authStore";
import type { SystemRole } from "../types/domain";
import { usePermissions, PERMISSIONS_QUERY_KEY } from "../hooks/usePermissions";
import {
  ADMIN_PERMISSIONS,
  PERMISSION_REGISTRY,
  type Permission,
  type PermissionCategory,
} from "../../supabase/functions/_shared/adminPermissions";

const statusLabels: Record<AdminUserStatus, string> = {
  initial_login_pending: "최초 로그인 전",
  password_change_required: "비밀번호 변경 필요",
  active: "활성",
  inactive: "비활성",
};

const statusTones: Record<
  AdminUserStatus,
  "neutral" | "green" | "amber" | "red"
> = {
  initial_login_pending: "neutral",
  password_change_required: "amber",
  active: "green",
  inactive: "red",
};

const systemRoleLabels: Record<SystemRole, string> = {
  user: "User",
  admin: "Admin",
};

const permissionCategoryLabels: Record<PermissionCategory, string> = {
  projects: "프로젝트 관리",
  users: "사용자 관리",
  permissions: "계정 유형 및 기능 권한",
  logs: "로그",
  ai: "AI",
};

const accessEventLabels: Record<AccessLogEventType, string> = {
  login: "로그인",
  logout: "로그아웃",
  password_changed: "비밀번호/PIN 변경",
  session_refreshed: "세션 갱신",
};

function displayDate(value: string | null): string {
  return value ? new Date(value).toLocaleString("ko-KR") : "-";
}

function displayCountry(code: string | null): string {
  if (!code) return "-";
  try {
    return `${new Intl.DisplayNames(["ko"], { type: "region" }).of(code) ?? code} (${code})`;
  } catch {
    return code;
  }
}

function AccessLogDialog({
  target,
  onClose,
}: {
  target: AdminUser | null;
  onClose: () => void;
}) {
  const pageSize = 25;
  const [page, setPage] = useState(0);
  const [eventType, setEventType] = useState<AccessLogEventType | "">("");
  useEffect(() => {
    setPage(0);
    setEventType("");
  }, [target?.id]);
  const logs = useQuery({
    queryKey: ["admin-access-logs", target?.id, page, eventType],
    queryFn: () =>
      listAdminAccessLogs({
        userId: target!.id,
        limit: pageSize,
        offset: page * pageSize,
        ...(eventType ? { eventType } : {}),
      }),
    enabled: Boolean(target),
  });
  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      title="접속 기록"
      description={`${target?.name ?? "사용자"}님의 최근 90일 인증·접속 기록입니다.`}
      className="max-w-6xl"
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <label className="label" htmlFor="access-event-filter">
            이벤트
          </label>
          <select
            id="access-event-filter"
            className="field min-w-48"
            value={eventType}
            onChange={(event) => {
              setEventType(event.target.value as AccessLogEventType | "");
              setPage(0);
            }}
          >
            <option value="">전체</option>
            {Object.entries(accessEventLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-muted">
          인증 감사 기록과 서비스 접속 기록을 함께 표시합니다.
        </p>
      </div>
      {logs.error && <Alert className="mb-4">{logs.error.message}</Alert>}
      {logs.isLoading ? (
        <div className="flex min-h-52 items-center justify-center">
          <Spinner />
        </div>
      ) : logs.data?.logs.length ? (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-line bg-raised text-xs text-muted">
              <tr>
                <th className="px-4 py-3">날짜/시간</th>
                <th className="px-4 py-3">이벤트</th>
                <th className="px-4 py-3">IP</th>
                <th className="px-4 py-3">국가</th>
                <th className="px-4 py-3">브라우저/기기</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {logs.data.logs.map((log) => (
                <tr key={log.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-ink">
                    {displayDate(log.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      tone={
                        log.eventType === "login"
                          ? "green"
                          : log.eventType === "password_changed"
                            ? "purple"
                            : "neutral"
                      }
                    >
                      {accessEventLabels[log.eventType]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">
                    {log.ipAddress ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {displayCountry(log.countryCode)}
                  </td>
                  <td className="px-4 py-3 text-muted">{log.device ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={<History />}
          title="접속 기록이 없습니다"
          description="기록 기능 배포 이후의 이벤트가 여기에 표시됩니다."
        />
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button
          variant="secondary"
          disabled={page === 0 || logs.isFetching}
          onClick={() => setPage((value) => value - 1)}
        >
          이전
        </Button>
        <Button
          variant="secondary"
          disabled={!logs.data?.hasMore || logs.isFetching}
          onClick={() => setPage((value) => value + 1)}
        >
          다음
        </Button>
      </div>
    </Modal>
  );
}

function CreateUserDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [studentId, setStudentId] = useState("");
  const [name, setName] = useState("");
  const [githubUsername, setGithubUsername] = useState("");
  const [created, setCreated] = useState<{
    studentId: string;
    name: string;
  } | null>(null);
  const mutation = useMutation({
    mutationFn: () =>
      createAdminUser({
        studentId,
        name,
        ...(githubUsername.trim()
          ? { githubUsername: githubUsername.trim() }
          : {}),
      }),
    onSuccess: async (result) => {
      setCreated({ studentId: result.user.student_id, name: result.user.name });
      showToast("사용자가 생성되었습니다.", { tone: "success", dedupeKey: `user-created:${result.user.id}` });
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: () => showToast("사용자를 생성하지 못했습니다.", { tone: "error" }),
  });
  const close = () => {
    setStudentId("");
    setName("");
    setGithubUsername("");
    setCreated(null);
    mutation.reset();
    onClose();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={created ? "사용자가 생성되었습니다." : "새 사용자"}
      description={
        created
          ? "첫 로그인 시 새 PIN 또는 비밀번호를 반드시 설정합니다."
          : "초기 비밀번호는 모든 신규 계정에서 1234로 고정됩니다."
      }
    >
      {created ? (
        <div>
          <dl className="divide-y divide-line rounded-xl border border-line">
            <div className="flex justify-between p-4">
              <dt className="text-sm text-muted">학번</dt>
              <dd className="font-bold text-ink">{created.studentId}</dd>
            </div>
            <div className="flex justify-between p-4">
              <dt className="text-sm text-muted">이름</dt>
              <dd className="font-bold text-ink">{created.name}</dd>
            </div>
            <div className="flex justify-between p-4">
              <dt className="text-sm text-muted">초기 비밀번호</dt>
              <dd className="font-mono text-lg font-black text-ink">1234</dd>
            </div>
          </dl>
          <Alert tone="info" className="mt-4">
            학번과 초기 비밀번호 1234를 사용자에게 전달하세요. 관리자는 이후
            사용자가 설정한 비밀번호를 볼 수 없습니다.
          </Alert>
          <Button className="mt-5 w-full" onClick={close}>
            확인
          </Button>
        </div>
      ) : (
        <form onSubmit={submit}>
          <label className="label" htmlFor="admin-student-id">
            학번 *
          </label>
          <Input
            id="admin-student-id"
            value={studentId}
            onChange={(event) => setStudentId(event.target.value)}
            inputMode="numeric"
            pattern="[0-9]{6,12}"
            placeholder="20260002"
            required
          />
          <label className="label mt-4" htmlFor="admin-name">
            이름 *
          </label>
          <Input
            id="admin-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            required
          />
          <label className="label mt-4" htmlFor="admin-github">
            GitHub 사용자명
          </label>
          <Input
            id="admin-github"
            value={githubUsername}
            onChange={(event) => setGithubUsername(event.target.value)}
            maxLength={39}
            pattern="[A-Za-z0-9-]{1,39}"
            placeholder="github-username"
          />
          <p className="mt-1.5 text-xs text-muted">
            GitHub 프로필 URL의 사용자명(@username)을 입력하세요. 예:
            github.com/username → username
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              취소
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <Plus size={16} />
              )}{" "}
              계정 생성
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function ResetPasswordDialog({
  target,
  onClose,
}: {
  target: AdminUser | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const mutation = useMutation({
    mutationFn: () => resetAdminUserPassword(target!.id),
    onSuccess: async () => {
      showToast("비밀번호가 초기화되었습니다.", { tone: "success" });
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: () => showToast("비밀번호를 초기화하지 못했습니다.", { tone: "error" }),
  });
  const close = () => {
    mutation.reset();
    onClose();
  };
  return (
    <Modal
      open={Boolean(target)}
      onClose={close}
      title="비밀번호 초기화"
      description={`${target?.name ?? "사용자"}님의 비밀번호를 초기화하시겠습니까?`}
    >
      {mutation.isSuccess ? (
        <div>
          <Alert tone="info">
            비밀번호가 1234로 초기화되었습니다. 다음 로그인에서 새 PIN 또는
            비밀번호 설정이 강제됩니다.
          </Alert>
          <Alert tone="info" className="mt-3">
            클라이언트 암호화 키는 안전하게 폐기되었습니다. 기존 프로젝트의
            민감한 데이터는 프로젝트 소유자나 관리자가 팀 화면에서 이 사용자의 키를
            다시 공유해야 열 수 있습니다.
          </Alert>
          <Button className="mt-5 w-full" onClick={close}>
            확인
          </Button>
        </div>
      ) : (
        <div>
          <p className="text-sm leading-6 text-muted">
            초기 비밀번호는 <strong className="font-mono text-ink">1234</strong>
            가 되며, 기존 세션의 업무 데이터 접근도 DB 정책에서 즉시 차단됩니다.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              취소
            </Button>
            <Button
              variant="danger"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <KeyRound size={16} />
              )}{" "}
              초기화
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function DeleteUserDialog({
  target,
  onClose,
}: {
  target: AdminUser | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [confirmation, setConfirmation] = useState("");
  useEffect(() => setConfirmation(""), [target?.id]);
  const mutation = useMutation({
    mutationFn: () => deleteAdminUser(target!.id, confirmation.trim()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      showToast("사용자가 삭제되었습니다.", { tone: "success" });
      onClose();
    },
    onError: () => showToast("사용자를 삭제하지 못했습니다.", { tone: "error" }),
  });
  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      title="사용자 완전 삭제"
      description="이 작업은 사용자 계정과 프로젝트 멤버십을 제거하며 되돌릴 수 없습니다."
    >
      <Alert>
        프로젝트 소유자와 시스템 관리자는 삭제할 수 없습니다. GitHub 팀원 권한을
        제거하지 못하면 계정 삭제도 중단됩니다.
      </Alert>
      <label className="label mt-4" htmlFor="delete-user-confirmation">
        확인을 위해 학번 {target?.student_id} 입력
      </label>
      <Input
        id="delete-user-confirmation"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        autoComplete="off"
      />
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          취소
        </Button>
        <Button
          variant="danger"
          disabled={
            confirmation.trim() !== target?.student_id || mutation.isPending
          }
          onClick={() => mutation.mutate()}
        >
          <Trash2 size={14} /> 완전 삭제
        </Button>
      </div>
    </Modal>
  );
}

function ChangeRoleDialog({
  target,
  onClose,
  onPromoted,
}: {
  target: AdminUser | null;
  onClose: () => void;
  onPromoted: (target: AdminUser) => void;
}) {
  const currentUser = useAuthStore((state) => state.user);
  const refreshProfile = useAuthStore((state) => state.refreshProfile);
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [role, setRole] = useState<SystemRole>("user");
  useEffect(() => {
    setRole(target?.system_role ?? "user");
  }, [target?.id, target?.system_role]);
  const mutation = useMutation({
    mutationFn: (nextRole: SystemRole) => setAdminUserRole(target!.id, nextRole),
    onSuccess: async (_, nextRole) => {
      queryClient.setQueryData<AdminUser[]>(["admin-users"], (current) =>
        current?.map((user) => user.id === target?.id ? { ...user, system_role: nextRole } : user),
      );
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      await queryClient.invalidateQueries({ queryKey: PERMISSIONS_QUERY_KEY });
      if (target?.id === currentUser?.id) await refreshProfile();
      showToast(`${target?.name ?? "사용자"}님의 계정 유형이 ${systemRoleLabels[nextRole]}으로 변경되었습니다.`, {
        tone: "success",
      });
      onClose();
      if (target && target.system_role === "user" && nextRole === "admin") {
        onPromoted({ ...target, system_role: "admin" });
      }
    },
    onError: () => showToast("계정 유형을 변경하지 못했습니다.", { tone: "error" }),
  });
  const close = () => {
    mutation.reset();
    onClose();
  };
  return (
    <Modal
      open={Boolean(target)}
      onClose={close}
      title="계정 유형 변경"
      description={`${target?.name ?? "사용자"}님의 관리상 계정 유형을 변경합니다.`}
    >
      <Alert tone="info">
        계정의 기본 분류입니다. 실제로 사용할 수 있는 기능은 기능 권한 설정에서 결정됩니다.
      </Alert>
      <label className="label mt-4" htmlFor="admin-system-role">계정 유형</label>
      <select
        id="admin-system-role"
        className="field"
        value={role}
        onChange={(event) => setRole(event.target.value as SystemRole)}
        disabled={mutation.isPending}
      >
        <option value="user">User</option>
        <option value="admin">Admin</option>
      </select>
      {target?.id === currentUser?.id && target?.system_role === "admin" && role === "user" && (
        <Alert className="mt-3">계정 유형을 User로 변경해도 현재 기능 권한은 그대로 유지됩니다.</Alert>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={close} disabled={mutation.isPending}>취소</Button>
        <Button
          onClick={() => mutation.mutate(role)}
          disabled={mutation.isPending || role === target?.system_role}
        >
          {mutation.isPending ? <Spinner className="h-4 w-4" /> : <Shield size={15} />}
          변경 확인
        </Button>
      </div>
    </Modal>
  );
}

function PermissionDialog({
  target,
  onClose,
}: {
  target: AdminUser | null;
  onClose: () => void;
}) {
  const currentUser = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [permissions, setPermissions] = useState<Permission[]>([]);
  useEffect(() => {
    setPermissions(target?.permissions ?? []);
  }, [target?.id, target?.permissions]);
  const mutation = useMutation({
    mutationFn: () => setUserPermissions(target!.id, permissions),
    onSuccess: async (saved) => {
      queryClient.setQueryData<AdminUser[]>(["admin-users"], (current) =>
        current?.map((user) => user.id === target?.id ? { ...user, permissions: saved } : user),
      );
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      if (target?.id === currentUser?.id) {
        await queryClient.invalidateQueries({ queryKey: PERMISSIONS_QUERY_KEY });
      }
      showToast("기능 권한이 변경되었습니다.", { tone: "success" });
      onClose();
    },
    onError: () => showToast("기능 권한을 변경하지 못했습니다.", { tone: "error" }),
  });
  const close = () => {
    mutation.reset();
    onClose();
  };
  const unchanged = [...permissions].sort().join("|")
    === [...(target?.permissions ?? [])].sort().join("|");
  return (
    <Modal
      open={Boolean(target)}
      onClose={close}
      title={`${target?.name ?? "사용자"} 기능 권한 설정`}
      description="프로젝트 생성·삭제, 사용자 관리 등 이 계정이 실제로 사용할 수 있는 기능을 설정합니다."
      className="max-w-2xl"
    >
      <div className="space-y-5">
        {(Object.keys(permissionCategoryLabels) as PermissionCategory[]).map((category) => (
          <fieldset key={category} disabled={mutation.isPending}>
            <legend className="mb-2 text-sm font-extrabold text-ink">
              {permissionCategoryLabels[category]}
            </legend>
            <div className="space-y-2">
              {PERMISSION_REGISTRY
                .filter((definition) => definition.category === category)
                .filter((definition) => definition.key !== ADMIN_PERMISSIONS.AI_USE)
                .filter((definition) => definition.key !== ADMIN_PERMISSIONS.AI_LOGS_VIEW || target?.system_role === "admin")
                .map((definition) => (
                  <label
                    key={definition.key}
                    className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 hover:bg-raised"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={permissions.includes(definition.key)}
                      onChange={(event) => setPermissions((current) =>
                        event.target.checked
                          ? [...current, definition.key]
                          : current.filter((permission) => permission !== definition.key),
                      )}
                    />
                    <span>
                      <span className="block text-sm font-bold text-ink">{definition.label}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-muted">{definition.description}</span>
                    </span>
                  </label>
                ))}
            </div>
          </fieldset>
        ))}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={close} disabled={mutation.isPending}>취소</Button>
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || unchanged}>
          {mutation.isPending ? <Spinner className="h-4 w-4" /> : <ShieldCheck size={15} />}
          저장
        </Button>
      </div>
    </Modal>
  );
}

export function AdminUsersPage() {
  const currentUser = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const permissions = usePermissions();
  const { showToast } = useToast();
  const canCreateUser = permissions.has(ADMIN_PERMISSIONS.USERS_CREATE);
  const canDeleteUser = permissions.has(ADMIN_PERMISSIONS.USERS_DELETE);
  const canChangeStatus = permissions.has(ADMIN_PERMISSIONS.USERS_CHANGE_STATUS);
  const canResetPassword = permissions.has(ADMIN_PERMISSIONS.USERS_RESET_PASSWORD);
  const canChangeRole = permissions.has(ADMIN_PERMISSIONS.USERS_CHANGE_ROLE);
  const canManagePermissions = permissions.has(ADMIN_PERMISSIONS.USERS_MANAGE_PERMISSIONS);
  const canViewAccessLogs = permissions.has(ADMIN_PERMISSIONS.ACCESS_LOGS_VIEW);
  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: listAdminUsers,
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [accessTarget, setAccessTarget] = useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [roleTarget, setRoleTarget] = useState<AdminUser | null>(null);
  const [permissionTarget, setPermissionTarget] = useState<AdminUser | null>(null);
  const statusMutation = useMutation({
    mutationFn: ({ userId, active }: { userId: string; active: boolean }) =>
      setAdminUserActive(userId, active),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      showToast(variables.active ? "사용자가 재활성화되었습니다." : "사용자가 비활성화되었습니다.", {
        tone: "success",
      });
    },
    onError: () => showToast("사용자 상태를 변경하지 못했습니다.", { tone: "error" }),
  });
  const toggleStatus = (target: AdminUser) => {
    const active = target.status === "inactive";
    const message = active
      ? `${target.name}님의 계정을 재활성화하시겠습니까?`
      : `${target.name}님의 로그인을 차단하고 계정을 비활성화하시겠습니까?`;
    if (window.confirm(message))
      statusMutation.mutate({ userId: target.id, active });
  };

  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="관리자"
        title="사용자 관리"
        description="사용자 계정과 최근 90일 접속 기록을 관리합니다."
        action={
          <Button onClick={() => setCreateOpen(true)} disabled={!canCreateUser}>
            <Plus size={16} /> 사용자 추가
          </Button>
        }
      />
      {users.error && (
        <Alert className="mb-4">
          {users.error.message}
        </Alert>
      )}
      {users.isLoading ? (
        <Spinner />
      ) : users.data?.length ? (
        <div className="space-y-2">
          {users.data.map((managedUser) => (
            <article
              key={managedUser.id}
              className="panel grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,.9fr)_auto]"
            >
              <div className="min-w-0">
                <div className="truncate font-bold text-ink">
                  {managedUser.name}
                </div>
                <div className="truncate font-mono text-[11px] text-muted">
                  {managedUser.student_id}
                  {managedUser.github_username
                    ? ` · @${managedUser.github_username}`
                    : ""}
                </div>
              </div>
              <div className="hidden min-w-0 flex-wrap gap-1 md:flex">
                <Badge tone={statusTones[managedUser.status]}>
                  {statusLabels[managedUser.status]}
                </Badge>
                <Badge
                  tone={
                    managedUser.system_role === "admin" ? "purple" : "neutral"
                  }
                >
                  {systemRoleLabels[managedUser.system_role]}
                  {` · 권한 ${managedUser.permissions.length}개`}
                </Badge>
              </div>
              <div className="hidden min-w-0 md:block">
                <p className="truncate text-[11px] text-muted">
                  최근 {displayDate(managedUser.lastSignInAt)}
                </p>
                <p className="truncate text-[10px] text-muted">
                  {managedUser.recentIpAddress ?? "IP 없음"} · 30일{" "}
                  {managedUser.loginCount30Days}회
                </p>
              </div>
              <div className="justify-self-end">
                <Popover
                  label={`${managedUser.name} 관리 메뉴`}
                  role="menu"
                  className="w-48 p-1"
                  trigger={(triggerProps) => (
                    <button
                      {...triggerProps}
                      type="button"
                      aria-label={`${managedUser.name} 관리 메뉴`}
                      title="관리 메뉴"
                      className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-raised hover:text-ink"
                    >
                      <MoreVertical size={17} />
                    </button>
                  )}
                >
                  {(close) => (
                    <>
                  <button
                    role="menuitem"
                    className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-raised disabled:opacity-40"
                    disabled={!canViewAccessLogs}
                    onClick={() => { close(); setAccessTarget(managedUser); }}
                  >
                    접속 기록 보기
                  </button>
                  <button
                    role="menuitem"
                    className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-raised disabled:opacity-40"
                    disabled={!canChangeRole}
                    onClick={() => { close(); setRoleTarget(managedUser); }}
                  >
                    계정 유형 변경
                  </button>
                  <button
                    role="menuitem"
                    className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-raised disabled:opacity-40"
                    disabled={!canManagePermissions}
                    onClick={() => { close(); setPermissionTarget(managedUser); }}
                  >
                    기능 권한 설정
                  </button>
                  <button
                    role="menuitem"
                    className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-raised disabled:opacity-40"
                    disabled={
                      managedUser.id === currentUser?.id ||
                      managedUser.status === "inactive" ||
                      !canResetPassword
                    }
                    onClick={() => { close(); setResetTarget(managedUser); }}
                  >
                    비밀번호 초기화
                  </button>
                  <button
                    role="menuitem"
                    className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-raised disabled:opacity-40"
                    disabled={
                      managedUser.id === currentUser?.id ||
                      statusMutation.isPending ||
                      !canChangeStatus
                    }
                    onClick={() => { close(); toggleStatus(managedUser); }}
                  >
                    {managedUser.status === "inactive"
                      ? "재활성화"
                      : "비활성화"}
                  </button>
                  <button
                    role="menuitem"
                    className="w-full rounded-lg px-3 py-2 text-left text-xs text-red-600 hover:bg-red-500/10 disabled:opacity-40"
                    disabled={
                      managedUser.id === currentUser?.id ||
                      managedUser.system_role === "admin" ||
                      !canDeleteUser
                    }
                    onClick={() => { close(); setDeleteTarget(managedUser); }}
                  >
                    완전 삭제
                  </button>
                    </>
                  )}
                </Popover>
              </div>
              <div className="col-span-2 flex gap-1 md:hidden">
                <Badge tone={statusTones[managedUser.status]}>
                  {statusLabels[managedUser.status]}
                </Badge>
                <Badge
                  tone={
                    managedUser.system_role === "admin" ? "purple" : "neutral"
                  }
                >
                  {systemRoleLabels[managedUser.system_role]}
                  {` · 권한 ${managedUser.permissions.length}개`}
                </Badge>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Users />}
          title="등록된 사용자가 없습니다"
          description="첫 사용자를 추가하세요."
        />
      )}
      <CreateUserDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
      <ResetPasswordDialog
        target={resetTarget}
        onClose={() => setResetTarget(null)}
      />
      <AccessLogDialog
        target={accessTarget}
        onClose={() => setAccessTarget(null)}
      />
      <DeleteUserDialog
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
      />
      <ChangeRoleDialog
        target={roleTarget}
        onClose={() => setRoleTarget(null)}
        onPromoted={setPermissionTarget}
      />
      <PermissionDialog
        target={permissionTarget}
        onClose={() => setPermissionTarget(null)}
      />
    </div>
  );
}

export function AdminProjectsPage() {
  const projects = useQuery({
    queryKey: ["admin-projects"],
    queryFn: listAdminProjects,
  });
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="관리자"
        title="프로젝트 관리"
        description="모든 프로젝트의 운영 상태와 GitHub 연결 상태를 확인합니다."
      />
      {projects.error && (
        <Alert className="mb-4">{projects.error.message}</Alert>
      )}
      {projects.isLoading ? (
        <Spinner />
      ) : projects.data?.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {projects.data.map((project) => (
            <article key={project.id} className="panel p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-extrabold text-ink">{project.name}</h2>
                  <p className="mt-1 text-xs text-muted">
                    {project.creator?.name ?? "알 수 없음"} ·{" "}
                    {project.creator?.student_id ?? "-"}
                  </p>
                </div>
                <Badge
                  tone={
                    project.status === "active"
                      ? "green"
                      : project.status === "error"
                        ? "red"
                        : "amber"
                  }
                >
                  {project.status}
                </Badge>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2">
                <div className="subtle-panel p-3">
                  <div className="text-lg font-black text-ink">
                    {project.project_members[0]?.count ?? 0}
                  </div>
                  <div className="text-[10px] text-muted">멤버</div>
                </div>
                <div className="subtle-panel p-3">
                  <div className="text-lg font-black text-ink">
                    {project.tasks[0]?.count ?? 0}
                  </div>
                  <div className="text-[10px] text-muted">작업</div>
                </div>
                <div className="subtle-panel p-3">
                  <div className="truncate text-xs font-bold text-ink">
                    {project.github_sync_status}
                  </div>
                  <div className="mt-1 text-[10px] text-muted">GitHub</div>
                </div>
              </div>
              <p className="mt-4 truncate text-xs text-muted">
                {project.github_repository_name}
              </p>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<FolderKanban />}
          title="프로젝트가 없습니다"
          description="사용자가 만든 프로젝트가 여기에 표시됩니다."
        />
      )}
    </div>
  );
}

export function AdminSystemPage() {
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="관리자"
        title="시스템 설정"
        description="배포 환경에서 확인해야 할 인증·보안 정책입니다."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <section className="panel p-5">
          <div className="flex items-center gap-2 text-ink">
            <ShieldCheck className="text-brand" size={20} />
            <h2 className="font-extrabold">인증 정책</h2>
          </div>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">공개 회원가입</dt>
              <dd className="font-bold text-ink">비활성화</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">최소 비밀번호 길이</dt>
              <dd className="font-bold text-ink">6</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">초기 비밀번호</dt>
              <dd className="font-mono font-black text-ink">1234</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">내부 이메일 노출</dt>
              <dd className="font-bold text-ink">없음</dd>
            </div>
          </dl>
        </section>
        <section className="panel p-5">
          <div className="flex items-center gap-2 text-ink">
            <Settings2 className="text-brand" size={20} />
            <h2 className="font-extrabold">운영 확인</h2>
          </div>
          <ul className="mt-4 space-y-3 text-sm text-muted">
            <li>• 데이터베이스 변경 사항 최신 상태 확인</li>
            <li>• 인증 감사 기록 저장 활성화</li>
            <li>• 서비스 주소와 서버 보안 설정 확인</li>
            <li>• 최초 시스템 관리자 등록 완료</li>
          </ul>
        </section>
      </div>
      <Alert tone="info" className="mt-5">
        실제 Supabase Dashboard 설정 절차는 SUPABASE_SETUP.md에 정리되어
        있습니다.
      </Alert>
    </div>
  );
}
