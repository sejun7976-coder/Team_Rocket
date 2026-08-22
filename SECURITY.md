# Security Model

## 권한과 암호화

세 보안 계층은 서로 대체하지 않는다.

1. Supabase Auth는 사용자를 인증한다.
2. Postgres/Storage RLS는 사용자가 어느 프로젝트 row/object에 접근할 수 있는지 제한한다.
3. AES-256-GCM은 Supabase 또는 Storage가 노출되어도 민감 content의 평문을 보호한다.

프로젝트 목록을 frontend에서 숨기는 것은 보안 통제가 아니다. 모든 업무 table과 Storage object는 `auth.uid()` 기반 RLS를 통과해야 한다.

## 학번 로그인

UI는 학번을 받지만 Supabase Auth에는 정규식 검증한 학번을 deterministic internal email(`<student_id>@project-manager.local`)로 변환해 인증한다. 사용자가 입력한 credential은 모든 계정 생성·로그인·변경·초기화 경로에서 `rocket-campus-auth:v1:{studentId}:{credential}`의 SHA-256 hex 값으로 변환한 뒤 Auth password로 전달한다. 이 derivation은 Hosted Auth 최소 길이와 4자리 PIN UX를 연결하는 compatibility layer이며 password entropy 강화 수단이 아니다. 학번만으로 로그인할 수 없으며 authorization은 어떤 경우에도 학번이 아니라 `auth.uid()`를 사용한다. 공개 signup은 비활성화된다. Internal email과 derived credential은 UI, API 응답, 로그에 표시하지 않는다.

최초 `system_admin`만 일회성 CLI로 bootstrap한다. 임시 Edge Function은 256-bit Secret을 constant-time hash 비교로 검증하고 Browser Origin을 거부한다. DB advisory lock, service-role 전용 recovery RPC, 완료 latch가 동시 bootstrap과 다른 관리자의 재실행을 차단한다. Auth 생성 후 finalize가 실패해도 생성된 UUID를 삭제하지 않고 다음 실행에서 Auth/profile metadata를 검증해 재사용한다. 일반 사용자를 자동 승격하지 않으며, 완료된 동일 관리자는 idempotent success, 다른 관리자는 영구 거부한다. CLI는 임시 Function과 Secret 삭제를 시도하며 Secret과 derived credential은 로그·응답에 포함하지 않는다. Bootstrap 관리자는 첫 로그인에서 비밀번호 변경과 keyring 생성을 완료해야 관리자 UI를 사용할 수 있다.

신규·초기화 사용자는 `must_change_password=true`와 `profiles.account_status=password_change_required`가 함께 설정된다. 영속적인 계정 lifecycle의 기준은 DB의 `profiles.account_status`와 keyring 존재 여부이며, Auth `app_metadata.must_change_password`는 JWT/RLS용 fail-closed mirror다. React Router와 RLS의 `can_access_business_data()`는 둘을 함께 검사하므로 어느 한쪽이라도 미완료이면 프로젝트 데이터를 읽지 못한다. 모든 service-role 업무 Edge Function도 동일 상태를 별도로 확인한다.

최초 로그인 완료는 Browser가 생성한 암호화 keyring과 derived Auth credential만 `complete-first-login`에 보내고, Edge Function이 Auth password → 원자적 profile/keyring RPC → Auth metadata 순서로 조정한다. 원문 PIN/비밀번호는 Browser 밖으로 전송하지 않는다. Auth password만 먼저 변경된 partial 상태에서는 같은 새 PIN으로 재시도하며 `same_password`를 이전 단계 성공으로 처리한다. 로그에는 user UUID, phase, allowlist 오류 코드, 완료 flag만 남기고 원문/derived credential, JWT, private key, salt를 남기지 않는다.

로그인 사용자가 호출하는 모든 protected Edge Function은 공통 authenticated invoke helper를 통과한다. Helper는 호출 직전 Auth session을 읽고 만료·이상 상태이면 한 번만 refresh한 뒤 현재 access token을 `Authorization: Bearer`로 명시한다. 세션이 없으면 네트워크 요청 전에 차단한다. Gateway와 Function 오류에서는 allowlist code와 호출별 일반 메시지만 보존하며 access token/JWT나 응답 원문을 로그·UI·telemetry에 전달하지 않는다. Edge Gateway의 JWT 검증과 Function 내부 `requireUser()` 검증은 모두 유지한다.

## Project key V1 정책

- Project마다 `crypto.getRandomValues`로 생성한 256-bit DEK를 사용한다.
- DEK는 Entity/file encryption에만 쓰며 AES-GCM마다 random 96-bit IV를 사용한다.
- AAD는 `rocket:v1:{projectId}:{entityType}:{entityId}[:chunkIndex]`로 row swap/chunk reorder를 탐지한다.
- DEK는 각 member의 P-256 public key에 ECDH/HKDF 기반으로 wrapping한다.
- 사용자 private key는 로그인 password 기반 PBKDF2(최소 310,000 iterations, random salt) KEK로 암호화한다.
- 원문 password/PIN, derived Auth credential, KEK, 평문 private JWK, project DEK는 localStorage/sessionStorage/IndexedDB에 저장하지 않는다.
- 활성 탭의 F5 복구에는 non-extractable AES-256-GCM `CryptoKey`와 그 키로 암호화한 private JWK envelope만 IndexedDB에 structured clone으로 보관한다. 탭 식별자와 비민감 마지막 활동 시각을 결합하며, 15분 미사용 또는 logout 시 IndexedDB record와 memory keyring을 모두 제거한다.

멤버 추가를 위해 unlock된 Project `CryptoKey`에 대응하는 raw 32-byte material을 모듈 내부 `WeakMap`에만 보관한다. UI/store에서 raw key를 읽을 수 없고 lock 시 즉시 덮어쓴 뒤 삭제한다. 영구 저장소에는 member별 wrapped key만 존재한다.

JavaScript string과 `CryptoKey`를 완전히 zeroize할 수 없으며, unlock된 브라우저의 XSS/악성 extension은 평문을 볼 수 있다. strict CSP, React escaping, `dangerouslySetInnerHTML`/`eval` 금지, runtime CDN 금지, dependency lockfile이 핵심 통제다.

멤버 제거는 이후 DB/Storage 접근과 wrapped key 획득을 차단하지만 이미 획득한 과거 DEK를 회수하지 못한다. V1은 팀 내부 협업 모델이며 강한 cryptographic revocation은 제공하지 않는다.

## RLS 정책 원칙

- Data API table GRANT와 RLS는 독립된 보안 계층이다. `authenticated`에는 frontend가 실제 사용하는 operation만 table별로 GRANT하고, `anon`과 `PUBLIC`에는 업무 table 권한을 주지 않는다.
- 새 table/function은 `ALTER DEFAULT PRIVILEGES`로 기본 비공개이며, 업무 table을 추가할 때 명시적 GRANT, RLS 활성화, operation별 Policy, pgTAP 검증을 한 migration에 함께 추가한다.
- `is_project_member(project_id)`와 `has_project_role(project_id, roles[])`는 `SECURITY DEFINER`, `SET search_path = ''`, 명시적 `public.` schema 참조를 사용한다.
- Viewer는 SELECT만 가능하다.
- Member는 Task/comment/file/calendar를 mutate할 수 있다.
- Owner/Admin만 project settings와 membership Edge Function을 사용할 수 있다.
- Owner membership은 제거하거나 강등할 수 없다.
- `project_members`와 `project_keys` mutation은 service role Edge Function만 수행해 DB membership과 key/GitHub sync가 분리되지 않게 한다.
- Client가 보낸 `created_by`, `author_id`, `added_by`, role은 신뢰하지 않는다. SQL default/trigger 또는 Edge Function의 verified user ID가 설정한다.

## GitHub credential

GitHub token/App credential은 Supabase Edge Function secret에만 저장한다. Frontend env에는 publishable Supabase key만 허용한다. Token은 지정 owner에 repository 생성/관리와 collaborator 초대에 필요한 최소 권한으로 제한한다.

`GITHUB_OWNER_TYPE=user`에서는 Edge Function이 GitHub `GET /user`로 token 소유자와 설정 Owner의 일치를 먼저 검증한다. Authorization header, token, GitHub 오류 response body는 애플리케이션 로그와 사용자 응답에 포함하지 않는다. 외부 오류는 고정된 safe error code로만 반환한다.

Repository의 idempotency marker는 고정된 가상 domain이 아니라 검증된 `PROJECT_MANAGER_URL`과 Project UUID로 만든다. Hosted 환경은 HTTPS URL을 필수로 요구하고, query·fragment·credential이 포함된 URL을 거부한다.

수동 Repository 생성 재시도, GitHub 관리 화면, Project/Repository 영구 삭제는 Project Owner만 사용할 수 있다. Team의 collaborator 자동 동기화는 Owner/Admin 관리 권한을 유지한다. 영구 삭제는 Repository marker가 현재 Project UUID와 일치할 때만 GitHub DELETE를 수행하며 401/403/5xx이면 DB Project를 보존한다.

## AI provider credential과 context

- Provider API key는 Frontend env와 browser storage에 두지 않고 `admin-ai-settings`로만 입력한다.
- `AI_CONFIG_MASTER_KEY`는 Supabase Edge Function Secret인 random 256-bit key이며 provider key와 별개다.
- Provider key는 AES-GCM ciphertext/IV로만 `ai_provider_settings`에 저장되고 service role만 table에 접근한다. Admin GET도 원문/ciphertext를 반환하지 않는다.
- `ai-assistant`는 ready user와 Project membership을 확인하고 user별 rate limit과 timeout을 적용한다.
- Project context는 browser에서 권한 있는 사용자가 복호화해 요청 시 최소화한다. Project key/keyring/Auth credential/JWT/GitHub PAT와 첨부 원문은 전송하지 않는다.
- Usage audit에는 prompt와 업무 plaintext를 저장하지 않는다. Provider 오류 body도 사용자나 log에 전달하지 않는다.
- AI mutation 결과는 structured proposal이며 사용자 확인 전에는 application service를 호출하지 않는다.

## XSS와 Markdown

사용자 Markdown은 HTML로 변환해 주입하지 않는다. React node 기반 제한 renderer가 text, code block, mention만 표시한다. HTML은 항상 text로 취급한다. Production bundle은 meta CSP로 self-only script, `object-src 'none'`, `base-uri 'none'`를 설정한다. GitHub Pages는 사용자 지정 response header를 지원하지 않으므로 `frame-ancestors`는 적용할 수 없다. Clickjacking 방어가 필수인 배포에서는 Pages 앞에 CDN을 두고 response header `Content-Security-Policy: frame-ancestors 'none'`를 추가해야 한다.

## 알려진 제한

- GitHub와 Supabase는 분산 transaction이 아니므로 보상/retry 상태가 잠시 보일 수 있다.
- 프로젝트명/Task 제목/status/date/담당 관계는 RLS metadata이며 Supabase 운영자에게 보일 수 있다.
- 사용자 password 분실 시 관리자는 사용자에게 보이는 credential을 `1234`로 초기화하고 Auth에는 학번과 `1234`에서 파생한 credential을 설정하지만, 이전 password로 보호된 encrypted private key는 복구할 수 없다. 초기화는 해당 keyring과 member별 wrapped project key를 폐기한다. 사용자가 새 keyring을 만든 뒤 다른 Owner/Admin이 project DEK를 다시 wrapping해야 한다. 다른 복호화 가능 멤버가 없는 1인 프로젝트의 암호화 content는 복구할 수 없다.
- GitHub collaborator 초대 수락과 실제 repository 접근은 GitHub 계정 상태에 의존한다.
