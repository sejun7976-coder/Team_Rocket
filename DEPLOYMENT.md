# GitHub Pages 배포

## Repository 설정

1. GitHub repository Settings > Pages에서 Source를 `GitHub Actions`로 선택한다.
2. Repository Variables에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`를 등록한다.
3. Supabase secret `FRONTEND_URL`을 최종 Pages origin으로 설정한다.
4. `main` branch에 push한다.

`.github/workflows/deploy.yml`은 lint → typecheck → test → build 순서로 검증한 뒤 `dist`를 Pages에 배포한다. Vite `base: "./"`와 React `HashRouter`를 사용하므로 repository 하위 경로에서도 새로고침 404가 발생하지 않는다.

## 배포 전 확인

```bash
npm ci
npm run lint
npm run typecheck
npm run test
npm run build
```

Migration과 Edge Function은 Pages workflow와 별개로 [SUPABASE_SETUP.md](./SUPABASE_SETUP.md)에 따라 먼저 배포한다.
