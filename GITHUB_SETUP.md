# GitHub 연동 설정

## Credential

권장 방식은 전용 fine-grained personal access token 또는 GitHub App이다. 토큰은 지정 Owner 아래 repository 생성, private repository 관리, collaborator 초대/제거에 필요한 최소 repository administration 권한만 부여한다.

다음 값은 Supabase Edge Function secret으로만 등록한다.

```bash
npx supabase secrets set GITHUB_TOKEN=<TOKEN> --project-ref joljmlyzhlwrlnbunusb
npx supabase secrets set GITHUB_OWNER=sejun7976-coder --project-ref joljmlyzhlwrlnbunusb
npx supabase secrets set GITHUB_OWNER_TYPE=user --project-ref joljmlyzhlwrlnbunusb
npx supabase secrets set PROJECT_MANAGER_URL=https://sejun7976-coder.github.io/Team_Rocket --project-ref joljmlyzhlwrlnbunusb
```

현재 Hosted 프로젝트의 설정은 `GITHUB_OWNER=sejun7976-coder`, `GITHUB_OWNER_TYPE=user`, `PROJECT_MANAGER_URL=https://sejun7976-coder.github.io/Team_Rocket`이다. `GITHUB_TOKEN` 값은 source, 문서, 응답, 로그에 기록하지 않는다. Function은 실행 시 Secret을 `Deno.env.get()`으로 읽고, `GET /user` 결과가 설정된 Owner와 일치하는지 확인한 뒤에만 Repository를 생성한다.

Repository idempotency marker는 `${PROJECT_MANAGER_URL}/#/projects/${projectId}`다. Hosted 환경에서는 `PROJECT_MANAGER_URL`이 없거나 HTTPS URL이 아니면 fail closed한다. 로컬 개발환경에서만 값이 없을 때 `http://127.0.0.1:3000`을 marker base로 사용한다. 운영 중 URL을 변경하면 기존 Repository marker와 달라질 수 있으므로 이 값을 안정적으로 유지한다.

설정 실패는 `GITHUB_TOKEN_MISSING`, `GITHUB_OWNER_MISSING`, `GITHUB_OWNER_INVALID`, `GITHUB_OWNER_TYPE_INVALID`, `PROJECT_MANAGER_URL_MISSING`, `PROJECT_MANAGER_URL_INVALID`로 구분한다. Function log에는 각 설정의 존재/유효 여부 boolean만 기록하며 Secret 값과 Owner 문자열은 기록하지 않는다. 설정을 확인할 때도 target 혼동을 막기 위해 `npx supabase secrets list --project-ref joljmlyzhlwrlnbunusb`를 사용한다.

Organization이면 `GITHUB_OWNER_TYPE=organization`을 사용하고 조직 정책에서 repository 생성과 outside collaborator 초대를 허용해야 한다.

선택적으로 template repository를 사용한다.

```bash
npx supabase secrets set GITHUB_TEMPLATE_OWNER=<OWNER>
npx supabase secrets set GITHUB_TEMPLATE_REPO=<REPOSITORY>
```

설정하지 않으면 private repository를 `auto_init=true`로 생성해 README를 초기화한다. GitHub token은 `.env`, source, GitHub Pages secret, 브라우저 localStorage에 넣지 않는다.

## Repository 자동 생성

`create-project`는 로그인 JWT와 계정 상태를 검증하고 다음 순서로 동작한다.

1. service-role 전용 RPC로 Project, Owner membership, Owner wrapped key를 원자적으로 생성한다.
2. GitHub API `POST /user/repos`를 호출해 기본 Private Repository와 README를 생성한다.
3. 실제 Project Manager URL과 Project UUID로 구성한 marker로 동일 요청과 이름 충돌을 구분한다.
4. GitHub Repository ID/URL을 저장하고 Project를 `active`로 전환한다.
5. 실패하면 안정적인 오류 코드와 `github_sync_jobs` 상태를 기록한다. GitHub 생성 후 DB 저장만 실패한 경우 `github-retry`의 `create_repository` 작업으로 기존 Repository를 찾아 복구한다.

GitHub REST API version은 지원 기간이 명시된 `2022-11-28`로 고정한다. Token 인증정보나 GitHub 오류 응답 body는 로그에 출력하지 않는다.

## 검증

1. 관리자 또는 일반 사용자로 로그인한다.
2. 새 프로젝트와 유일한 repository 이름을 입력한다.
3. 생성 후 Project > GitHub에서 실제 private repository URL을 연다.
4. Project > Team에서 GitHub Username이 있는 사용자를 추가한다.
5. GitHub collaborator invitation과 `github_sync_status`를 확인한다.
