import type { SupabaseEnvironmentName } from "../lib/supabaseConfig";

export function ConfigurationErrorScreen({ issues }: { issues: SupabaseEnvironmentName[] }) {
  return <main className="flex min-h-screen items-center justify-center bg-canvas p-4">
    <section role="alert" className="panel w-full max-w-xl p-7 sm:p-10">
      <div className="eyebrow">Configuration error</div>
      <h1 className="mt-3 text-2xl font-extrabold text-ink">서비스 설정을 확인해 주세요.</h1>
      <p className="mt-3 text-sm leading-6 text-muted">Supabase 연결 정보가 없거나 올바르지 않아 앱을 안전하게 시작하지 않았습니다.</p>
      <div className="mt-6 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
        <div className="font-bold">확인이 필요한 GitHub Actions Variables</div>
        <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-xs">
          {issues.map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      </div>
      <p className="mt-5 text-xs leading-5 text-muted">Repository Settings → Secrets and variables → Actions → Variables에서 값을 등록한 뒤 Pages workflow를 다시 실행하세요.</p>
    </section>
  </main>;
}
