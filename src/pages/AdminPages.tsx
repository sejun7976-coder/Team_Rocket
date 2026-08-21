import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, KeyRound, Plus, Settings2, ShieldCheck, UserCheck, UserRoundX, Users } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Alert, Badge, Button, EmptyState, Input, Modal, PageHeader, Spinner } from "../components/ui";
import {
  createAdminUser,
  listAdminProjects,
  listAdminUsers,
  resetAdminUserPassword,
  setAdminUserActive,
  type AdminUser,
  type AdminUserStatus
} from "../services/admin";
import { useAuthStore } from "../stores/authStore";

const statusLabels: Record<AdminUserStatus, string> = {
  initial_login_pending: "최초 로그인 전",
  password_change_required: "비밀번호 변경 필요",
  active: "활성",
  inactive: "비활성"
};

const statusTones: Record<AdminUserStatus, "neutral" | "green" | "amber" | "red"> = {
  initial_login_pending: "neutral",
  password_change_required: "amber",
  active: "green",
  inactive: "red"
};

function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [studentId, setStudentId] = useState("");
  const [name, setName] = useState("");
  const [githubUsername, setGithubUsername] = useState("");
  const [created, setCreated] = useState<{ studentId: string; name: string } | null>(null);
  const mutation = useMutation({
    mutationFn: () => createAdminUser({ studentId, name, ...(githubUsername.trim() ? { githubUsername: githubUsername.trim() } : {}) }),
    onSuccess: async (result) => {
      setCreated({ studentId: result.user.student_id, name: result.user.name });
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    }
  });
  const close = () => { setStudentId(""); setName(""); setGithubUsername(""); setCreated(null); mutation.reset(); onClose(); };
  const submit = (event: FormEvent) => { event.preventDefault(); mutation.mutate(); };

  return <Modal open={open} onClose={close} title={created ? "사용자가 생성되었습니다." : "새 사용자"} description={created ? "첫 로그인 시 새 PIN 또는 비밀번호를 반드시 설정합니다." : "초기 비밀번호는 모든 신규 계정에서 1234로 고정됩니다."}>
    {created ? <div><dl className="divide-y divide-line rounded-xl border border-line"><div className="flex justify-between p-4"><dt className="text-sm text-muted">학번</dt><dd className="font-bold text-ink">{created.studentId}</dd></div><div className="flex justify-between p-4"><dt className="text-sm text-muted">이름</dt><dd className="font-bold text-ink">{created.name}</dd></div><div className="flex justify-between p-4"><dt className="text-sm text-muted">초기 비밀번호</dt><dd className="font-mono text-lg font-black text-ink">1234</dd></div></dl><Alert tone="info" className="mt-4">학번과 초기 비밀번호 1234를 사용자에게 전달하세요. 관리자는 이후 사용자가 설정한 비밀번호를 볼 수 없습니다.</Alert><Button className="mt-5 w-full" onClick={close}>확인</Button></div> : <form onSubmit={submit}>{mutation.error && <Alert className="mb-4">{mutation.error.message}</Alert>}<label className="label" htmlFor="admin-student-id">학번 *</label><Input id="admin-student-id" value={studentId} onChange={(event) => setStudentId(event.target.value)} inputMode="numeric" pattern="[0-9]{6,12}" placeholder="20260002" required /><label className="label mt-4" htmlFor="admin-name">이름 *</label><Input id="admin-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required /><label className="label mt-4" htmlFor="admin-github">GitHub Username</label><Input id="admin-github" value={githubUsername} onChange={(event) => setGithubUsername(event.target.value)} maxLength={39} placeholder="optional" /><div className="mt-6 flex justify-end gap-2"><Button variant="secondary" onClick={close}>취소</Button><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? <Spinner className="h-4 w-4" /> : <Plus size={16} />} 계정 생성</Button></div></form>}
  </Modal>;
}

function ResetPasswordDialog({ target, onClose }: { target: AdminUser | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => resetAdminUserPassword(target!.id),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["admin-users"] }); }
  });
  const close = () => { mutation.reset(); onClose(); };
  return <Modal open={Boolean(target)} onClose={close} title="비밀번호 초기화" description={`${target?.name ?? "사용자"}님의 비밀번호를 초기화하시겠습니까?`}>
    {mutation.isSuccess ? <div><Alert tone="success">비밀번호가 1234로 초기화되었습니다. 다음 로그인에서 새 PIN 또는 비밀번호 설정이 강제됩니다.</Alert><Alert tone="info" className="mt-3">클라이언트 암호화 키는 안전하게 폐기되었습니다. 기존 프로젝트의 민감한 데이터는 Owner/Admin이 프로젝트 팀 화면에서 이 사용자의 키를 다시 공유해야 열 수 있습니다.</Alert><Button className="mt-5 w-full" onClick={close}>확인</Button></div> : <div><p className="text-sm leading-6 text-muted">초기 비밀번호는 <strong className="font-mono text-ink">1234</strong>가 되며, 기존 세션의 업무 데이터 접근도 DB 정책에서 즉시 차단됩니다.</p>{mutation.error && <Alert className="mt-4">{mutation.error.message}</Alert>}<div className="mt-6 flex justify-end gap-2"><Button variant="secondary" onClick={close}>취소</Button><Button variant="danger" onClick={() => mutation.mutate()} disabled={mutation.isPending}>{mutation.isPending ? <Spinner className="h-4 w-4" /> : <KeyRound size={16} />} 초기화</Button></div></div>}
  </Modal>;
}

export function AdminUsersPage() {
  const currentUser = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: ["admin-users"], queryFn: listAdminUsers });
  const [createOpen, setCreateOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const statusMutation = useMutation({
    mutationFn: ({ userId, active }: { userId: string; active: boolean }) => setAdminUserActive(userId, active),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["admin-users"] }); }
  });
  const toggleStatus = (target: AdminUser) => {
    const active = target.status === "inactive";
    const message = active ? `${target.name}님의 계정을 재활성화하시겠습니까?` : `${target.name}님의 로그인을 차단하고 계정을 비활성화하시겠습니까?`;
    if (window.confirm(message)) statusMutation.mutate({ userId: target.id, active });
  };

  return <div className="page-wrap"><PageHeader eyebrow="Admin" title="사용자 관리" description="계정 생성, 상태 변경, 비밀번호 초기화는 모두 서버에서 관리자 권한을 다시 확인합니다." action={<Button onClick={() => setCreateOpen(true)}><Plus size={16} /> 사용자 추가</Button>} />{(users.error || statusMutation.error) && <Alert className="mb-4">{users.error?.message ?? statusMutation.error?.message}</Alert>}{users.isLoading ? <Spinner /> : users.data?.length ? <div className="panel overflow-x-auto"><table className="w-full min-w-[820px] text-left"><thead className="border-b border-line bg-raised text-xs text-muted"><tr><th className="px-4 py-3">학번</th><th className="px-4 py-3">이름</th><th className="px-4 py-3">상태</th><th className="px-4 py-3">GitHub</th><th className="px-4 py-3">권한</th><th className="px-4 py-3 text-right">관리</th></tr></thead><tbody className="divide-y divide-line">{users.data.map((managedUser) => <tr key={managedUser.id} className="text-sm"><td className="px-4 py-4 font-mono font-semibold text-ink">{managedUser.student_id}</td><td className="px-4 py-4 font-bold text-ink">{managedUser.name}</td><td className="px-4 py-4"><Badge tone={statusTones[managedUser.status]}>{statusLabels[managedUser.status]}</Badge></td><td className="px-4 py-4 text-muted">{managedUser.github_username ? `@${managedUser.github_username}` : "-"}</td><td className="px-4 py-4"><Badge tone={managedUser.system_role === "admin" ? "purple" : "neutral"}>{managedUser.system_role}</Badge></td><td className="px-4 py-4"><div className="flex justify-end gap-2"><Button size="sm" variant="secondary" disabled={managedUser.id === currentUser?.id || managedUser.status === "inactive"} onClick={() => setResetTarget(managedUser)}><KeyRound size={14} /> 비밀번호 초기화</Button><Button size="sm" variant={managedUser.status === "inactive" ? "secondary" : "ghost"} disabled={managedUser.id === currentUser?.id || statusMutation.isPending} className={managedUser.status === "inactive" ? "text-emerald-700" : "text-red-600"} onClick={() => toggleStatus(managedUser)}>{managedUser.status === "inactive" ? <><UserCheck size={14} /> 재활성화</> : <><UserRoundX size={14} /> 비활성화</>}</Button></div></td></tr>)}</tbody></table></div> : <EmptyState icon={<Users />} title="등록된 사용자가 없습니다" description="첫 사용자를 추가하세요." />}<CreateUserDialog open={createOpen} onClose={() => setCreateOpen(false)} /><ResetPasswordDialog target={resetTarget} onClose={() => setResetTarget(null)} /></div>;
}

export function AdminProjectsPage() {
  const projects = useQuery({ queryKey: ["admin-projects"], queryFn: listAdminProjects });
  return <div className="page-wrap"><PageHeader eyebrow="Admin" title="프로젝트 관리" description="모든 프로젝트의 운영 상태와 GitHub 연결 상태를 확인합니다. 민감한 암호화 내용은 관리자에게도 노출되지 않습니다." />{projects.error && <Alert className="mb-4">{projects.error.message}</Alert>}{projects.isLoading ? <Spinner /> : projects.data?.length ? <div className="grid gap-4 lg:grid-cols-2">{projects.data.map((project) => <article key={project.id} className="panel p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-extrabold text-ink">{project.name}</h2><p className="mt-1 text-xs text-muted">{project.creator?.name ?? "알 수 없음"} · {project.creator?.student_id ?? "-"}</p></div><Badge tone={project.status === "active" ? "green" : project.status === "error" ? "red" : "amber"}>{project.status}</Badge></div><div className="mt-5 grid grid-cols-3 gap-2"><div className="subtle-panel p-3"><div className="text-lg font-black text-ink">{project.project_members[0]?.count ?? 0}</div><div className="text-[10px] text-muted">멤버</div></div><div className="subtle-panel p-3"><div className="text-lg font-black text-ink">{project.tasks[0]?.count ?? 0}</div><div className="text-[10px] text-muted">작업</div></div><div className="subtle-panel p-3"><div className="truncate text-xs font-bold text-ink">{project.github_sync_status}</div><div className="mt-1 text-[10px] text-muted">GitHub</div></div></div><p className="mt-4 truncate text-xs text-muted">{project.github_repository_name}</p></article>)}</div> : <EmptyState icon={<FolderKanban />} title="프로젝트가 없습니다" description="사용자가 만든 프로젝트가 여기에 표시됩니다." />}</div>;
}

export function AdminSystemPage() {
  return <div className="page-wrap">
    <PageHeader eyebrow="Admin" title="시스템 설정" description="배포 환경에서 확인해야 할 인증·보안 정책입니다." />
    <div className="grid gap-4 md:grid-cols-2"><section className="panel p-5"><div className="flex items-center gap-2 text-ink"><ShieldCheck className="text-brand" size={20} /><h2 className="font-extrabold">Auth 정책</h2></div><dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between"><dt className="text-muted">Public signup</dt><dd className="font-bold text-ink">비활성화</dd></div><div className="flex justify-between"><dt className="text-muted">Minimum password length</dt><dd className="font-bold text-ink">6</dd></div><div className="flex justify-between"><dt className="text-muted">초기 비밀번호</dt><dd className="font-mono font-black text-ink">1234</dd></div><div className="flex justify-between"><dt className="text-muted">내부 이메일 노출</dt><dd className="font-bold text-ink">없음</dd></div></dl></section><section className="panel p-5"><div className="flex items-center gap-2 text-ink"><Settings2 className="text-brand" size={20} /><h2 className="font-extrabold">운영 확인</h2></div><ul className="mt-4 space-y-3 text-sm text-muted"><li>• Migration 001~006 순서대로 적용</li><li>• Auth/Admin Edge Function 6개 배포</li><li>• FRONTEND_URL과 service role secret 확인</li><li>• 최초 관리자 one-time bootstrap 완료</li></ul></section></div>
    <Alert tone="info" className="mt-5">실제 Supabase Dashboard 설정 절차는 SUPABASE_SETUP.md에 정리되어 있습니다.</Alert>
  </div>;
}
