# Team Rocket

대학생 소규모 팀을 위한 React + Supabase 프로젝트 관리 SPA다. GitHub Pages에서 정적으로 동작하며 Supabase Auth/RLS/Realtime/Storage와 Edge Functions를 사용한다.

## 주요 기능

- 관리자 전용 계정 생성, 학번 로그인, 최초 비밀번호 변경 강제
- 사용자별 프로젝트 격리와 Owner/Admin/Member/Viewer 권한
- Overview 진행률·내 작업·마감·최근 활동·팀 workload 대시보드
- Kanban, 복수 담당자, checklist, 댓글, 일정, 활동 기록, 알림 센터
- Browser AES-256-GCM 암호화 파일 공유, 가상 폴더, 프로젝트별 DEK
- 단일 AI Gateway와 32개 모델 registry 기반 Project Assistant, Rocket AI
- 선택형 GitHub Repository 연동, collaborator 동기화, 최근 commit 요약
- GitHub Repository 실상태 reconciliation과 감사 기록을 보존하는 관리자 계정 삭제
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
