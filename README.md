# Team Rocket

팀 프로젝트의 작업, 일정, 파일, 진행 상황을 한 곳에서 관리하는 프로젝트 관리 서비스다. GitHub Pages에서 정적으로 동작하며 Supabase Auth/RLS/Realtime/Storage와 Edge Functions를 사용한다.

## 주요 기능

- 관리자 전용 계정 생성, 학번 로그인, 최초 비밀번호 변경 강제
- 사용자별 프로젝트 격리와 소유자/관리자/팀원/열람자 권한
- 개요의 진행률·내 작업·마감·최근 활동·팀 현황
- 보드, 복수 담당자, 체크리스트, 댓글, 캘린더, 활동 기록, 알림
- 브라우저 암호화 파일 공유와 가상 폴더
- 선택형 GitHub 저장소 연동, 팀원 권한 동기화, 최근 커밋
- GitHub 저장소 상태 확인과 감사 기록을 보존하는 관리자 계정 삭제
- HashRouter 기반 GitHub Pages 배포, light/dark 반응형 UI

## 로컬 실행

```bash
npm install
copy .env.example .env.local
npm run dev
```

`.env.local`에는 Browser-safe Supabase URL과 publishable key만 넣는다.

## 검증

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Supabase RLS 통합 테스트는 Docker와 local stack이 필요하다.

```bash
npx supabase start
npx supabase db reset
npx supabase test db
```

## 설정 문서

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [SUPABASE_SETUP.md](./SUPABASE_SETUP.md)
- [GITHUB_SETUP.md](./GITHUB_SETUP.md)
- [SECURITY.md](./SECURITY.md)
- [DEPLOYMENT.md](./DEPLOYMENT.md)
