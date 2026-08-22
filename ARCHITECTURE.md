# Rocket Campus Architecture

## 목표

Rocket Campus는 5~10명의 대학생이 3~4개 프로젝트를 관리하는 SPA다. GitHub Pages에는 정적 React bundle만 배포하고, 인증·업무 데이터·권한·Realtime·파일은 Supabase가 담당한다. Supabase Edge Functions만 GitHub credential을 보유하며 실제 프로젝트 repository를 생성하고 collaborator를 동기화한다.

```text
GitHub Pages (HashRouter SPA)
  ├─ Supabase Auth (student ID → internal email + derived credential)
  ├─ Postgres + RLS (project management source of truth)
  ├─ Realtime (RLS-filtered postgres_changes)
  ├─ Storage (encrypted project files)
  └─ Edge Functions ── GitHub REST API
```

GitHub repository는 소스 코드와 Git history를 위한 것이며 업무 DB로 사용하지 않는다.

## 신뢰 경계

- 브라우저는 Supabase publishable key만 가진다. service role key와 GitHub token은 절대 bundle에 포함하지 않는다.
- 데이터 접근 권한은 UI filter가 아닌 Postgres RLS의 `auth.uid()`와 membership으로 판정한다.
- Edge Function은 `Authorization: Bearer <Supabase JWT>`를 검증하고 client의 `created_by`, `owner_id`, `role` 값을 신뢰하지 않는다.
- 일반 계정 생성은 `system_admin` 전용 Edge Function만 수행한다. 최초 로그인 gate는 Router, DB profile 상태, JWT app metadata, Edge Function 검증에 중복 적용한다. DB profile/keyring이 영속적인 lifecycle 기준이고 Auth metadata는 JWT/RLS용 fail-closed mirror다. 완료 과정은 derived credential만 받는 Edge Function과 service-role 전용 원자적 finalize RPC가 담당하므로 동일 PIN 재시도와 응답 유실을 복구할 수 있다.
- 최초 `system_admin`은 one-time DB claim/latch와 임시 Secret으로 보호되는 bootstrap Function에서 한 명만 생성한다. Auth 생성과 DB finalize 사이의 partial 상태는 내부 email, Auth metadata, profile UUID/role을 검사해 같은 UUID로 복구한다. 완료된 동일 identity만 idempotent success로 처리하며 다른 관리자는 영구 차단한다. 임시 Function과 Secret은 CLI가 실행 직후 제거한다.
- Auth password 경계에서는 공통 Web Crypto 함수가 `rocket-campus-auth:v1:{studentId}:{credential}`의 SHA-256 hex 값을 만든다. 초기값 `1234`, 4자리 PIN, 일반 비밀번호 모두 같은 compatibility layer를 통과하며 derived 값은 UI나 로그에 노출하지 않는다.
- 민감 본문은 project-specific DEK로 브라우저에서 AES-256-GCM 암호화한 envelope만 저장한다.

## 데이터 분리

RLS와 query에 필요한 metadata는 평문이다.

- `project_id`, `task_id`, `user_id`, role, status, priority, progress, date, revision
- 프로젝트명과 Task 제목은 목록 표시와 운영 검색을 위해 V1에서 평문 metadata다.

민감 content는 암호화한다.

- Project note, Task description, checklist text, comment body
- original filename, file bytes, activity의 사용자 작성 payload

## 프로젝트 키 구조

각 프로젝트는 독립 random 256-bit DEK를 사용한다. 사용자마다 P-256 ECDH key pair를 갖고, private key JWK는 로그인 password에서 PBKDF2-SHA-256으로 만든 KEK로 AES-256-GCM 암호화되어 `profiles`에 저장된다. password는 derivation 직후 폐기된다. 활성 탭의 새로고침 복구를 위해 별도의 non-extractable AES-256-GCM `CryptoKey`와 그 키로 다시 암호화한 private JWK envelope만 IndexedDB에 보관한다.

프로젝트 생성자는 DEK를 자기 public key로 wrapping한다. 팀원을 추가할 때 현재 프로젝트 DEK를 대상 사용자의 public key로 wrapping해 `project_keys`에 별도 저장한다. wrapping은 ephemeral P-256 ECDH → HKDF-SHA-256 → AES-256-GCM이다. Supabase와 GitHub는 project DEK를 평문으로 보지 않는다.

새로고침 후 Supabase session과 탭에 묶인 session keyring record를 모두 hydrate한 뒤 Router guard가 판단한다. 마지막 활동이 15분 이내이면 현재 route와 in-memory keyring을 복구하고, 만료되었거나 record가 없으면 `/unlock`으로 이동한다. 원문 password/PIN, derived Auth credential, 평문 private JWK, project DEK는 browser persistent storage에 기록하지 않는다. RLS 접근 권한과 복호화 가능성은 별개다.

멤버 제거 시 RLS 권한과 wrapped key row는 즉시 제거된다. 이미 복호화한 멤버가 과거 key를 보유했을 가능성은 V1 잔여 위험이다. 강한 퇴출 보안이 필요하면 DEK rotation과 모든 content 재암호화가 필요하다.

## 프로젝트 생성 보상 흐름

1. 브라우저가 project DEK와 caller용 wrapped key를 만든다.
2. `create-project`가 JWT를 검증한다.
3. service-role 전용 SQL RPC가 `projects(status=creating)`, owner membership, owner wrapped key를 한 transaction에 삽입한다.
4. Edge Function이 지정 owner에 private repository(`auto_init=true`)를 만든다.
5. 성공 시 GitHub ID/URL과 `active` 상태를 기록한다.
6. 실패 시 안정적인 error code와 `error` 상태를 기록한다. 같은 idempotency key는 기존 project를 반환/재시도해 중복 repository를 막는다.

GitHub 성공 후 DB finalize가 실패하면 `github-retry`가 owner/repository name과 GitHub repository ID를 조회해 연결을 복구한다.

## Realtime

업무 table은 `supabase_realtime` publication에 추가한다. client는 현재 사용자가 member인 project channel만 subscribe한다. Postgres Changes authorization은 각 row를 구독자 JWT의 RLS로 검사한다. membership 삭제 즉시 channel을 해제하고 query cache를 제거한다.

## Storage

bucket은 private `project-files`이며 object path는 `{projectId}/{fileId}/encrypted.bin`이다. browser가 4 MiB chunk 단위 AES-GCM envelope container를 만든 후 upload한다. Storage RLS는 path 첫 segment를 UUID로 해석하고 membership을 검사한다. original filename과 checksum은 encrypted file metadata에 저장한다.

## 프런트엔드 경계

- `src/crypto`: keyring, project key wrapping, envelopes, file chunking. Supabase/React import 금지.
- `src/lib`: Supabase client와 순수 유틸리티.
- `src/services`: RLS 대상 query/mutation과 Edge Function 호출.
- `src/stores`: auth/keyring/UI session 상태. 영속 복구 material은 `src/crypto/sessionKeyring.ts`의 암호화 경계를 통해서만 다룬다.
- `src/features`, `src/pages`, `src/components`: 유스케이스와 표시.

## 배포

Vite `base: "./"`와 `HashRouter`를 사용해 GitHub Pages 하위 경로 문제를 피한다. Actions는 lint → typecheck → unit test → build 후 Pages artifact를 배포한다. Edge Functions와 migrations는 Supabase CLI로 별도 적용한다.
