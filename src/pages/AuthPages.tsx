import { CheckSquare, FolderKanban, KeyRound, LockKeyhole, Users } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Alert, Button, Input, Spinner } from "../components/ui";
import { needsFirstLogin, validateNewPassword, type PasswordMode } from "../lib/authPolicy";
import { isSupabaseConfigured } from "../lib/supabase";
import { FirstLoginReauthenticationError, useAuthStore } from "../stores/authStore";

function Brand() {
  return <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand text-white shadow-lg shadow-brand/20"><FolderKanban size={19} /></div><div><div className="font-extrabold tracking-tight text-ink">Team Rocket</div><div className="text-[10px] font-bold tracking-[.12em] text-muted">프로젝트 관리</div></div></div>;
}

export function LoginPage() {
  const { initialized, user, profile, login, loading, error, clearError } = useAuthStore();
  const navigate = useNavigate();
  const [studentId, setStudentId] = useState("");
  const [password, setPassword] = useState("");
  if (!initialized) return <main className="flex min-h-screen items-center justify-center bg-canvas"><Spinner /></main>;
  if (user) return <Navigate to={needsFirstLogin(user, profile) ? "/first-login" : "/dashboard"} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    clearError();
    try {
      const destination = await login(studentId, password);
      navigate(destination === "first-login" ? "/first-login" : "/dashboard", { replace: true });
    } catch { /* 안전한 오류는 store에서 표시한다. */ }
  };

  return <main className="min-h-screen bg-canvas px-4 py-8 sm:py-14"><div className="mx-auto mb-10 max-w-6xl"><Brand /></div><div className="mx-auto grid max-w-6xl overflow-hidden rounded-3xl border border-line bg-surface shadow-soft lg:grid-cols-[1.1fr_.9fr]">
    <section className="hidden min-h-[650px] flex-col justify-between border-r border-line bg-raised p-10 text-ink lg:flex"><div><div className="eyebrow">프로젝트 관리</div><h1 className="mt-5 max-w-lg text-4xl font-extrabold leading-tight tracking-tight">우리 프로젝트를<br />한곳에서, 더 명확하게.</h1><p className="mt-5 max-w-md text-sm leading-7 text-muted">프로젝트와 작업, 일정, 담당자, 진행 상황을 한곳에서 관리하고 팀의 흐름을 빠르게 확인하세요.</p><div className="mt-8 flex gap-3 text-brand"><FolderKanban /><CheckSquare /><Users /></div></div><div className="grid gap-3"><div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4"><FolderKanban className="text-brand" /><div><div className="text-sm font-bold">업무 흐름 한눈에</div><div className="text-xs text-muted">칸반·일정·진행률을 프로젝트 단위로 정리</div></div></div><div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4"><CheckSquare className="text-brand" /><div><div className="text-sm font-bold">팀 협업 정리</div><div className="text-xs text-muted">담당자·댓글·체크리스트·활동 기록을 한곳에서</div></div></div></div></section>
    <section className="flex min-h-[580px] items-center p-6 sm:p-10 lg:p-12"><form onSubmit={submit} className="w-full"><div className="mb-8"><div className="eyebrow">다시 오신 것을 환영합니다</div><h2 className="mt-2 text-3xl font-extrabold tracking-tight text-ink">로그인</h2><p className="mt-2 text-sm text-muted">관리자가 발급한 학번과 비밀번호를 입력하세요.</p></div>{!isSupabaseConfigured && <Alert tone="info" className="mb-4">서비스 연결 정보가 없어 로그인할 수 없습니다. 관리자에게 문의하세요.</Alert>}{error && <Alert className="mb-4">{error}</Alert>}<label className="label" htmlFor="student-id">학번</label><Input id="student-id" value={studentId} onChange={(event) => setStudentId(event.target.value)} inputMode="numeric" autoComplete="username" placeholder="20260001" pattern="[0-9]{6,12}" required className="mb-4" /><label className="label" htmlFor="password">비밀번호 / PIN</label><Input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="••••" minLength={4} required /><Button type="submit" size="lg" className="mt-6 w-full" disabled={loading || !isSupabaseConfigured}>{loading ? <><Spinner className="h-4 w-4 border-white/30 border-t-white" /> 인증 중</> : <><KeyRound size={17} /> 로그인</>}</Button><p className="mt-5 text-center text-xs leading-5 text-muted">이메일 주소는 필요하지 않습니다. 신규 계정의 초기 비밀번호는 1234입니다.</p></form></section>
  </div></main>;
}

export function FirstLoginPage() {
  const { initialized, user, profile, completeFirstLogin, loading, error, logout } = useAuthStore();
  const navigate = useNavigate();
  const [mode, setMode] = useState<PasswordMode>("pin");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  if (!initialized) return <main className="flex min-h-screen items-center justify-center bg-canvas"><Spinner /></main>;
  if (!user || !profile) return <Navigate to="/login" replace />;
  if (!needsFirstLogin(user, profile)) return <Navigate to="/dashboard" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const policyError = validateNewPassword(mode, password);
    if (policyError) { setValidationError(policyError); return; }
    if (password !== confirmation) { setValidationError("새 비밀번호가 서로 일치하지 않습니다."); return; }
    setValidationError(null);
    try {
      await completeFirstLogin(password);
      navigate("/dashboard", { replace: true });
    } catch (caught) {
      if (caught instanceof FirstLoginReauthenticationError) navigate("/login", { replace: true });
    }
  };

  return <main className="flex min-h-screen items-center justify-center bg-canvas p-4"><section className="panel w-full max-w-xl p-6 sm:p-9"><div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand"><KeyRound /></div><div className="eyebrow">첫 로그인</div><h1 className="mt-2 text-2xl font-extrabold text-ink">처음 로그인하셨습니다.</h1><p className="mt-2 text-sm leading-6 text-muted">{profile.name}님, 프로젝트를 사용하기 전에 새 PIN 또는 비밀번호를 설정해 주세요.</p><p className="mt-2 text-xs leading-5 text-muted">이전 변경이 중단된 뒤 다시 들어왔다면, 로그인할 때 사용한 새 PIN 또는 비밀번호를 그대로 입력하면 안전하게 완료됩니다.</p>
    <form onSubmit={submit} className="mt-7"><fieldset><legend className="label">로그인 방식</legend><div className="grid gap-3 sm:grid-cols-2"><label className={`cursor-pointer rounded-xl border p-4 ${mode === "pin" ? "border-brand bg-brand/5" : "border-line"}`}><input type="radio" name="password-mode" value="pin" checked={mode === "pin"} onChange={() => { setMode("pin"); setPassword(""); setConfirmation(""); }} className="mr-2" /><span className="text-sm font-bold text-ink">4자리 PIN</span><p className="ml-6 mt-1 text-xs text-muted">숫자 정확히 4자리</p></label><label className={`cursor-pointer rounded-xl border p-4 ${mode === "password" ? "border-brand bg-brand/5" : "border-line"}`}><input type="radio" name="password-mode" value="password" checked={mode === "password"} onChange={() => { setMode("password"); setPassword(""); setConfirmation(""); }} className="mr-2" /><span className="text-sm font-bold text-ink">일반 비밀번호</span><p className="ml-6 mt-1 text-xs text-muted">문자·숫자·특수문자, 4자 이상</p></label></div></fieldset>
      {(validationError || error) && <Alert className="mt-4">{validationError ?? error}</Alert>}<div className="mt-5"><label className="label" htmlFor="new-password">새 {mode === "pin" ? "PIN" : "비밀번호"}</label><Input id="new-password" type="password" inputMode={mode === "pin" ? "numeric" : undefined} pattern={mode === "pin" ? "[0-9]{4}" : undefined} minLength={4} maxLength={mode === "pin" ? 4 : 128} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required /></div><div className="mt-4"><label className="label" htmlFor="new-password-confirmation">새 {mode === "pin" ? "PIN" : "비밀번호"} 확인</label><Input id="new-password-confirmation" type="password" inputMode={mode === "pin" ? "numeric" : undefined} minLength={4} maxLength={mode === "pin" ? 4 : 128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" required /></div><Button type="submit" size="lg" className="mt-6 w-full" disabled={loading}>{loading ? <><Spinner className="h-4 w-4 border-white/30 border-t-white" /> 변경 중</> : "변경하고 시작하기"}</Button><Button type="button" variant="ghost" className="mt-2 w-full" onClick={() => void logout()} disabled={loading}>로그아웃</Button></form>
  </section></main>;
}

export function UnlockPage() {
  const { initialized, keyringHydrated, user, profile, keyring, unlockKeyring, loading, error } = useAuthStore();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  if (!initialized || !keyringHydrated) return <main className="flex min-h-screen items-center justify-center bg-canvas"><Spinner /></main>;
  if (!user) return <Navigate to="/login" replace />;
  if (needsFirstLogin(user, profile)) return <Navigate to="/first-login" replace />;
  if (keyring) return <Navigate to="/dashboard" replace />;
  const submit = async (event: FormEvent) => { event.preventDefault(); try { await unlockKeyring(password); navigate("/dashboard", { replace: true }); } catch { /* safe store error */ } };
  return <main className="flex min-h-screen items-center justify-center bg-canvas p-4"><div className="panel w-full max-w-md p-6 sm:p-8"><div className="mb-7 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand"><LockKeyhole /></div><h1 className="text-2xl font-extrabold text-ink">보안 잠금 해제</h1><p className="mt-2 text-sm font-semibold leading-6 text-ink">로그아웃된 것이 아닙니다. 프로젝트 보안 키만 잠겼습니다.</p><p className="mt-1 text-sm leading-6 text-muted">로그인 비밀번호를 다시 입력하면 작업을 계속할 수 있습니다.</p>{error && <Alert className="mt-4">{error}</Alert>}<form onSubmit={submit} className="mt-6"><label className="label" htmlFor="unlock-password">비밀번호</label><Input id="unlock-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" minLength={4} required /><Button type="submit" className="mt-4 w-full" size="lg" disabled={loading}>{loading ? <Spinner /> : "잠금 해제"}</Button></form></div></main>;
}
