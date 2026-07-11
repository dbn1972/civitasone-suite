# court-service web console (isolated)

Self-contained court MIS web console — kept OUT of the shared apps/web PWA to preserve branch isolation. Renders the judicial-performance dashboard, overdue/pendency MIS and case register from the court-service REST APIs (GET /v1/court/cases/analytics, /pendency, /overdue, /cases, /v1/public/establishments).

## Run live (verified 2026-07-11)
Start: cd services/court-service && PORT=3034 DATABASE_URL=postgres://court_svc:court_dev_pw@localhost:5435/civitas_court QUEUE_DRIVER=memory CACHE_DRIVER=memory SEARCH_DRIVER=memory JWT_ALGORITHM=HS256 JWT_SECRET=... COURT_PII_KEY=... COURT_OTP_PEPPER=... pnpm exec tsx src/index.ts
Then serve console.html (add Authorization: Bearer <HS256 token> for authed reads).

## Production integration
Add a gateway-service route /api/v1/courts -> court-service:3034 and mount these views under apps/web (app)/legal/ — a shared-repo change to coordinate with the apps/web owner.
