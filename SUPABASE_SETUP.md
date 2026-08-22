# Supabase 설정

이 문서는 Team Rocket의 실제 Supabase 프로젝트를 준비하는 순서다. Browser에는 `VITE_SUPABASE_URL`과 publishable key만 제공한다. service role key는 절대 `.env`, GitHub Pages, 브라우저 bundle에 넣지 않는다.

## 1. 프로젝트 연결과 Migration

```bash
npm install
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push
```

Migration은 반드시 순서대로 적용한다.

1. `202608220001_initial_schema.sql`: 업무 schema, RLS, Storage, Realtime
2. `202608220002_admin_account_policy.sql`: 관리자 계정, 최초 로그인 gate, 계정 상태, 감사 로그
3. `202608220003_explicit_data_api_grants.sql`: Data API 최소 권한 GRANT, 익명 접근 차단, 기본 권한 잠금
4. `202608220004_system_admin_bootstrap.sql`: 최초 관리자 one-time claim/latch, service-role 전용 bootstrap RPC
5. `202608220005_recoverable_system_admin_bootstrap.sql`: partial bootstrap 상태 판별, 기존 Auth UUID 재사용, recovery finalize와 안전한 오류 코드
6. `202608220006_idempotent_first_login.sql`: service-role 전용 최초 로그인 finalize RPC, profile/keyring 원자적 저장과 재시도 복구
7. `202608220007_admin_project_access_logs.sql`: system_admin 전용 프로젝트 생성 DB 방어, 90일 접속 로그, Auth Audit Log 관리자 RPC
8. `202608220008_task_atomic_and_ai.sql`: 암호화 작업 생성 RPC와 초기 AI 설정
9. `202608220009_ai_registry_user_deletion_task_rpc.sql`: multi-provider AI registry, 사용자 완전 삭제 지원, task RPC 재게시
10. `202608220010_fix_domain_activity_triggers.sql`: table별 활동 trigger 분리, `tasks` row에 없는 `user_id` 참조 제거
11. `202608220011_fix_task_deletion.sql`: Task cascade 삭제 시 assignee DELETE trigger의 부모 재조회 실패 방지
12. `202608220012_single_ai_gateway.sql`: service-role 전용 단일 AI Gateway와 32개 모델 registry, 전역 default 제약
13. `202608220013_enhance_project_notification_types.sql`: task/comment/file/overdue notification enum 확장
14. `202608220014_virtual_file_folders.sql`: 암호화된 가상 폴더 metadata, `files.folder_id`, GRANT와 RLS
15. `202608220015_decouple_project_github_status.sql`: 선택형 GitHub 연동과 프로젝트 상태를 분리하는 service-role RPC
16. `202608220016_materialize_project_notifications.sql`: task/comment/file notification trigger와 사용자별 마감 알림 refresh RPC

SQL Editor에서 table을 수동 생성하지 않는다.

Dashboard에서 `Automatically expose new tables`는 OFF, `Enable automatic RLS`는 ON으로 유지한다. Migration은 Dashboard 기본값에 의존하지 않고 각 업무 table의 `authenticated` GRANT와 RLS를 명시한다. `anon`과 `PUBLIC`에는 업무 table 권한이 없으며 새 table과 function도 기본적으로 노출되지 않는다.

## 2. Hosted Auth 설정

Supabase Dashboard의 Authentication 설정에서 다음 값을 직접 확인한다.

- Email/Password provider: 사용
- Public signup: 비활성화
- Minimum password length: `6`
- Password requirements: 없음
- Prevent leaked passwords: OFF
- Email confirmation: 관리자 API가 `email_confirm: true`로 생성하므로 사용자 확인 메일 불필요
- JWT expiry: 기본 3600초 사용 가능
- Authentication → Audit Logs → **Write audit logs to the database: ON**

Auth Audit Log의 DB 저장을 켜면 `auth.audit_log_entries`의 로그인·로그아웃·비밀번호 변경·token refresh가 관리자 접속 기록의 authoritative source로 사용된다. `auth` schema는 Data API에 노출하지 않으며 브라우저가 직접 조회하지 않는다. 국가·기기 보강용 `public.user_access_logs`는 service-role 전용이고, 신규 이벤트 기록 시 90일이 지난 행을 indexed opportunistic cleanup으로 제거하므로 Free plan에서도 `pg_cron` 없이 동작한다.

사용자에게 보이는 공통 초기 비밀번호는 `1234`이고, 최초 로그인 이후 정확히 숫자 4자리 PIN 또는 일반 비밀번호를 사용할 수 있다. 이 원문 credential은 Supabase Auth에 직접 전달하지 않는다. 모든 Auth 생성·로그인·변경·초기화 경로는 `rocket-campus-auth:v1:{studentId}:{credential}`을 Web Crypto SHA-256으로 digest한 64자리 hex credential을 전달한다. 이는 password entropy를 높이는 보안 기능이 아니라 Hosted Auth 최소 길이 제약과 4자리 PIN UX를 연결하는 compatibility layer다.

로컬 설정은 [supabase/config.toml](./supabase/config.toml)에 이미 반영되어 있다.

```toml
[auth]
enable_signup = false
minimum_password_length = 6
```

설정 변경 후 로컬 stack을 재시작한다.

## 3. 최초 system admin bootstrap

Dashboard에서 Auth 사용자를 수동 생성하거나 `auth.users`를 직접 UPDATE하지 않는다. 1절의 `supabase login`, `supabase link`, `supabase db push`와 4절의 상시 Edge Function 배포를 완료한 작업 PC에서 아래 명령을 정확히 한 번 실행한다.

```bash
npm run bootstrap:admin
```

운영자가 직접 입력하는 값은 다음 세 가지뿐이다. 관리자 초기 비밀번호는 일반 사용자와 동일하게 `1234`로 고정되므로 입력하지 않는다.

1. `Supabase Project ref`: 현재 directory가 이미 `supabase link`되어 있으면 자동으로 읽으므로 묻지 않는다. 묻는 경우 Dashboard URL `https://supabase.com/dashboard/project/<PROJECT_REF>`의 `<PROJECT_REF>` 20자 값을 입력한다.
2. `최초 관리자 학번`: 숫자 6~12자리. 예: `20260001`.
3. `최초 관리자 이름`: 화면에 표시할 1~80자 이름.

이 명령은 먼저 아직 적용되지 않은 migration을 `db push`한 뒤, 사람이 입력하지 않는 256-bit 일회용 Secret을 메모리에서 생성하고 다음 작업을 자동 수행한다.

```text
SYSTEM_ADMIN_BOOTSTRAP_SECRET 임시 등록
→ bootstrap-system-admin 임시 배포
→ Auth Admin API로 system_admin 1명 생성
→ DB bootstrap latch 완료
→ 임시 Function 삭제
→ 임시 Secret 삭제
```

Bootstrap Function은 임시 Secret을 자체 검증하므로 배포 시에만 `--no-verify-jwt`를 사용하며, Browser 요청은 거부한다. DB advisory lock과 영구 latch가 동시 실행 및 두 번째 실행을 차단한다. Secret은 source, shell history, 응답, 로그에 기록하지 않는다. Auth 사용자는 `password=deriveAuthCredential(studentId, "1234")`, `must_change_password=true`로 생성된다. Derived credential은 출력하거나 운영자가 입력하지 않는다.

명령 종료 전에 임시 Function과 Secret의 삭제 결과가 출력된다. 삭제 확인 경고가 나오면 새 계정 생성 명령을 다시 실행하지 말고 Supabase Dashboard의 Edge Functions와 Edge Function Secrets에서 `bootstrap-system-admin`, `SYSTEM_ADMIN_BOOTSTRAP_SECRET`이 남아 있지 않은지만 확인한다.

성공 후 관리자는 `학번 + 초기 비밀번호 1234`로 로그인해 `/#/first-login`에서 새 4자리 PIN 또는 일반 비밀번호를 설정한다. 이 과정에서 암호화 keyring도 생성된다. 이후 모든 일반 사용자 계정은 반드시 관리자 웹 UI `/#/admin/users`의 `사용자 추가`에서 생성한다. Bootstrap 명령은 다시 실행하지 않는다.

### Partial bootstrap 확인과 복구

실패 후에는 Auth user를 수동 생성·UPDATE·DELETE하지 않는다. 같은 학번으로 `npm run bootstrap:admin`을 다시 실행하면 005 migration이 먼저 적용되고 다음 상태를 자동 판별한다.

- Auth user만 존재: 기존 UUID를 재사용하고 관리자 profile을 생성한 뒤 latch를 완료한다.
- Auth user와 profile이 존재: metadata와 UUID를 검증하고 기존 row로 latch만 완료한다.
- profile만 있거나 Auth/profile UUID가 다름: 자동 변경하지 않고 `PBA04`로 중단한다.
- incomplete legacy latch만 존재: 동일 실행에서 새 recovery claim으로 교체한다.
- 같은 관리자로 이미 완료: 성공으로 처리한다.
- 다른 관리자로 이미 완료: `PBA01`로 영구 차단한다.

Hosted 상태를 변경하지 않고 확인하려면 Dashboard의 `Authentication > Users`에서 내부 email을 확인하고, `SQL Editor`에서 아래 read-only SQL만 실행한다. `encrypted_password`나 Secret은 조회하지 않는다.

```sql
with target_auth as (
  select
    id,
    email,
    raw_app_meta_data ->> 'system_role' as auth_system_role,
    raw_app_meta_data ->> 'must_change_password' as must_change_password,
    raw_user_meta_data ->> 'student_id' as metadata_student_id
  from auth.users
  where lower(email) = lower('20221948@project-manager.local')
),
target_profile as (
  select id, student_id, name, system_role::text, account_status::text
  from public.profiles
  where student_id = '20221948'
),
latch as (
  select status, user_id, claimed_at, completed_at
  from public.system_admin_bootstrap_state
  where singleton = true
)
select jsonb_build_object(
  'auth', coalesce((select to_jsonb(target_auth) from target_auth), 'null'::jsonb),
  'profile', coalesce((select to_jsonb(target_profile) from target_profile), 'null'::jsonb),
  'latch', coalesce((select to_jsonb(latch) from latch), 'null'::jsonb)
) as bootstrap_state;
```

`auth`, `profile`, `latch`가 모두 `null`이면 이전 실패의 보상 삭제와 claim release가 모두 완료된 clean 상태다. Auth user가 없어도 latch만 남을 수 있으며 recovery RPC가 legacy incomplete claim을 안전하게 인수한다.

### Partial 최초 로그인 복구

최초 로그인 도중 Auth 비밀번호 변경 후 Function 응답 또는 DB 완료 단계가 실패했더라도 Auth user, profile, bootstrap latch를 수동 UPDATE/DELETE하지 않는다. `202608220006`과 최신 `complete-first-login` Function 및 Frontend를 배포한 뒤 다음 순서만 수행한다.

1. 초기 비밀번호 `1234`가 아니라, 실패 직전에 선택했던 **새 PIN 또는 비밀번호**로 로그인한다.
2. 다시 표시되는 `/#/first-login`에서 로그인할 때 사용한 값을 동일하게 입력한다.
3. Function은 Auth의 `same_password`를 성공한 이전 단계로 취급하고 기존 user UUID에서 profile/keyring/metadata만 완료한다.
4. Dashboard 진입 후 로그아웃하고 같은 새 PIN으로 다시 로그인해 `/#/first-login`으로 되돌아가지 않는지 확인한다.

완료 판정의 영속적인 기준은 `profiles.account_status`와 keyring 존재 여부다. `auth.users.raw_app_meta_data.must_change_password`는 JWT/RLS가 fail-closed하도록 복제한 gate다. 둘 중 하나라도 미완료이면 Router와 RLS는 업무 화면 접근을 허용하지 않으며, 완료 Function이 두 상태를 조정한 뒤 새 세션과 profile을 다시 검증한다.

## 4. Edge Function 배포

```bash
npx supabase functions deploy admin-create-user
npx supabase functions deploy admin-list-users
npx supabase functions deploy admin-reset-password
npx supabase functions deploy admin-set-user-status
npx supabase functions deploy admin-delete-user
npx supabase functions deploy complete-first-login
npx supabase functions deploy admin-list-projects
npx supabase functions deploy create-project
npx supabase functions deploy sync-project-member
npx supabase functions deploy remove-project-member
npx supabase functions deploy github-retry
npx supabase functions deploy github-repository-status
npx supabase functions deploy delete-github-repository
npx supabase functions deploy record-access-event
npx supabase functions deploy admin-list-access-logs
npx supabase functions deploy ai-assistant
npx supabase functions deploy ai-models
npx supabase functions deploy admin-ai-settings
npx supabase functions deploy delete-task
```

상시 배포하는 모든 Function은 JWT 검증을 유지하며 `--no-verify-jwt`로 배포하지 않는다. 유일한 예외는 3절의 CLI가 배포 후 즉시 삭제하는 일회성 `bootstrap-system-admin`이다. `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`는 hosted Edge Function에 기본 제공되는 값을 사용한다.

```bash
npx supabase secrets set FRONTEND_URL=https://<GITHUB_USER>.github.io
npx supabase secrets set PROJECT_MANAGER_URL=https://sejun7976-coder.github.io/Team_Rocket
npx supabase secrets set GITHUB_TOKEN=<TOKEN>
npx supabase secrets set GITHUB_OWNER=<OWNER>
npx supabase secrets set GITHUB_OWNER_TYPE=user
```

`FRONTEND_URL`은 CORS allowlist이므로 path 없는 browser origin을 권장한다. 이전 안내대로 `https://<GITHUB_USER>.github.io/<REPOSITORY>` 전체 URL이 이미 등록되어 있어도 공통 HTTP 계층이 `URL.origin`으로 정규화하므로 동일하게 동작한다. `PROJECT_MANAGER_URL`은 repository marker용 실제 앱 URL이므로 `/Team_Rocket` path를 포함한다.

## 5. 운영 계정 흐름

```text
system admin이 사용자 생성
  → Auth Admin API가 <학번>@project-manager.local 생성
  → Auth password=deriveAuthCredential(학번, "1234"), email_confirm=true
  → must_change_password=true
  → 사용자에게 학번 + 1234 전달
  → 로그인 입력도 같은 규칙으로 derive한 뒤 Auth에 전달
  → /#/first-login에서 4자리 PIN 또는 일반 비밀번호 설정
  → Browser가 원문으로 keyring을 보호하고, 원문은 전송하지 않음
  → derived credential + 암호화 keyring만 complete-first-login에 전송
  → Edge Function이 Auth password 변경(same_password 재시도 허용)
  → service-role RPC가 profile 활성화와 keyring을 원자적으로 저장
  → Auth metadata 완료 후 refreshSession/getUser/profile 재검증
  → 프로젝트 사용
```

내부 email과 derived credential은 UI, 응답, 로그에 표시하지 않는다. 사용자 입력 원문은 keyring 처리 중 메모리에만 존재하고 DB, `profiles`, 로그, analytics, localStorage, sessionStorage, IndexedDB에 저장하지 않는다. Supabase Auth에는 derived credential만 전달한다.

## 6. 비활성화와 비밀번호 초기화

- 비활성화는 Auth 장기 ban과 `profiles.account_status=inactive`를 함께 적용한다.
- 비밀번호 초기화는 Auth password를 `deriveAuthCredential(studentId, "1234")`로 설정하고 `must_change_password=true`로 되돌린다. 사용자에게 안내하는 값은 계속 `1234`다.
- RLS는 JWT claim뿐 아니라 DB account status도 검사하므로 초기화 직전 발급된 JWT도 즉시 업무 데이터 접근이 차단된다.
- 관리자는 사용자가 변경한 현재 비밀번호를 조회할 수 없다.

클라이언트 암호화 private key는 이전 비밀번호로 보호되어 있어 비밀번호 분실 시 복구할 수 없다. 관리자 초기화는 기존 사용자 keyring과 해당 사용자의 wrapped project key를 폐기한다. 새 비밀번호 설정 후 프로젝트 Owner/Admin이 Team 화면에서 해당 사용자를 다시 추가하거나 키 재공유 동작을 실행해야 한다. 다른 멤버도 키를 보유하지 않은 1인 프로젝트의 암호화 본문은 복구할 수 없다.

## 7. RLS 테스트

Docker를 실행한 뒤 다음을 수행한다.

```bash
npx supabase start
npx supabase db reset
npx supabase test db
```

`supabase/tests/grants_and_rls.sql`은 업무 table별 정확한 `authenticated` GRANT, `anon` 무권한, RLS 활성화, GRANT별 대응 Policy를 검증한다. `supabase/tests/rls_account_policy.sql`은 다음을 검증한다.

- `must_change_password=true`인 프로젝트 멤버의 SELECT/INSERT 차단
- 비밀번호 변경 완료 멤버의 접근 허용
- 비멤버가 이미 알고 있는 UUID로 profiles, projects, members, keys, tasks, assignees, checklist, comments, activities, files, notifications, GitHub jobs를 조회하거나 변경하려는 공격 차단
- stale JWT를 가진 비활성 사용자의 접근 차단

`supabase/tests/task_trigger_regression.sql`은 실제 `create_task_atomic` 호출로 0/1/2명 담당자, NULL/유효 마감일, 중복·비멤버 담당자, activity/notification trigger 동작과 원자적 rollback을 검증한다. 또한 담당자·댓글·파일 metadata·알림이 있는 Task의 cascade 삭제와 감사 activity 보존을 회귀 테스트한다.

## 8. Frontend 환경 변수

`.env.example`을 `.env.local`로 복사하고 다음 두 값만 설정한다.

```env
VITE_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE_KEY>
```

설정 후 `npm run build` 결과물에 service role key나 GitHub token이 없는지 확인한다.

## 9. Rocket AI 운영 설정

Migration 012는 기존 provider별 table과 암호문을 삭제하지 않고 deprecated 상태로 보존하며, 실제 runtime을 `ai_gateway_settings` singleton과 `ai_model_settings` registry로 전환한다. 모든 활성 모델은 동일한 Gateway Base URL/API Key를 사용하고, `family`는 화면 그룹에만 사용한다. 기본 catalog는 32개이며 최초 default는 `gpt-5.6-sol`이다.

이미 등록한 `AI_CONFIG_MASTER_KEY`는 **재생성하거나 rotate하지 않는다.** 기존 환경에서는 아래 Secret 생성 명령도 다시 실행하지 않는다. 신규 환경에서 Secret이 전혀 없을 때만 아래 PowerShell 명령으로 값을 화면에 출력하지 않고 한 번 등록한다.

```powershell
$rocketAiBytes = [byte[]]::new(32)
[System.Security.Cryptography.RandomNumberGenerator]::Fill($rocketAiBytes)
$rocketAiMasterKey = [Convert]::ToBase64String($rocketAiBytes).TrimEnd('=').Replace('+','-').Replace('/','_')
npx supabase secrets set "AI_CONFIG_MASTER_KEY=$rocketAiMasterKey" --project-ref joljmlyzhlwrlnbunusb
Remove-Variable rocketAiMasterKey, rocketAiBytes
```

그 다음 변경 Function을 JWT 검증을 유지한 채 배포한다.

```bash
npx supabase functions deploy ai-assistant --project-ref joljmlyzhlwrlnbunusb
npx supabase functions deploy ai-models --project-ref joljmlyzhlwrlnbunusb
npx supabase functions deploy admin-ai-settings --project-ref joljmlyzhlwrlnbunusb
npx supabase functions deploy delete-task --project-ref joljmlyzhlwrlnbunusb
```

system admin으로 `/#/admin/ai`를 열어 HTTPS Gateway Base URL과 Gateway API Key 하나를 저장한다. Key는 기존 `AI_CONFIG_MASTER_KEY`로 AES-GCM 암호화되어 저장되며, 저장 후 Browser에는 설정 여부만 반환되고 원문은 다시 표시되지 않는다. 운영 URL은 localhost, link-local, private IP를 거부하며 `AI_GATEWAY_ALLOWED_HOSTS` Secret을 쉼표 구분 hostname 목록으로 설정하면 exact host allowlist도 적용할 수 있다.

같은 화면에서 사용할 모델만 활성화하고 정확히 하나를 default로 지정한다. default 모델은 다른 default를 지정하기 전에는 비활성화/삭제할 수 없다. builtin 모델은 삭제하지 않고 비활성화하며, 관리자가 추가한 custom 모델만 삭제할 수 있다. `ai_gateway_settings`와 `ai_model_settings`에는 anon/authenticated Data API 권한이 없고, 일반 사용자는 `ai-models`의 safe response로 활성 model setting UUID, model ID, family, 표시 이름만 받는다.
