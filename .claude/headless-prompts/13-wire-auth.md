You are wiring Keycloak RS256 JWT authentication into every service in CivitasOne Suite.
Read CLAUDE.md first.

## What was already done
- `packages/auth/src/index.ts` — verifyJwt() using jwks-rsa (RS256) with HS256 test fallback
- `packages/auth/src/plugin.ts` — Fastify `authPlugin` that verifies Bearer token on every request,
  attaches `RequestContext` to `req.ctx`, auto-skips /health /ready /metrics
- Every service already has `@civitasone/auth` in its package.json dependencies

## What this prompt must do
For EACH of the following 18 services (skip if service directory does not exist):
  identity-service, policy-service, audit-service, notification-service,
  finance-service, procurement-service, contract-service,
  hrms-service, payroll-service, estab-service,
  asset-service, stock-service, project-service,
  grant-service, citizen-service, legal-service,
  admin-service, billing-service

Do ALL of the following per service:

---

### Step A — Register authPlugin in src/app.ts

Read the current `services/{svc}/src/app.ts`.
Find the line `await app.register(cors, ...)` (or equivalent cors/helmet registration).
Insert IMMEDIATELY after it:

```typescript
import { authPlugin } from "@civitasone/auth/plugin";
// (add import at top of file with other imports)

// After cors registration:
await app.register(authPlugin);
```

Rules:
- The import goes at the TOP of the file with other imports — not inline.
- `authPlugin` must be registered AFTER cors but BEFORE any business route registrations.
- Do NOT modify /health, /ready, /metrics routes — they are already auto-exempted by the plugin.
- Do NOT add authPlugin if it is already registered (check before editing).

### Step B — Mark public routes that must skip auth

Some routes must remain unauthenticated. After adding authPlugin, add `{ config: { public: true } }`
to the route options for these specific cases:

**identity-service only:**
- `POST /identity/sessions` — this is the login endpoint; users are not yet authenticated
- Any route in `sessions/routes.ts` that handles login (POST, no auth required)

**citizen-service only:**
- `GET /citizen/services` — public service directory, no login required
- `GET /citizen/services/:id` — public service detail

The authPlugin checks `req.routeOptions?.config?.public === true` to skip verification.
Update the plugin at `packages/auth/src/plugin.ts` to support this:

In the `onRequest` hook, BEFORE the Bearer check, add:
```typescript
// @ts-ignore — Fastify route config
if (req.routeOptions?.config?.public === true) return;
```

### Step C — Add env vars to .env.example (if it exists)

In `services/{svc}/.env.example` (create if missing), ensure these lines exist:
```
KEYCLOAK_URL=http://civitasone-keycloak:8080
KEYCLOAK_REALM=civitasone
JWT_ALGORITHM=RS256
# For tests only:
# JWT_ALGORITHM=HS256
# JWT_SECRET=test_secret_32_chars_minimum_len
```

### Step D — Update tests to use HS256 bypass

In each service's test files (`*.test.ts`), if they import `buildApp()` and call routes,
the tests need a valid token. Apply this pattern to the test setup:

```typescript
// At top of test file (after existing imports):
import { signToken } from "@civitasone/auth";

// In beforeAll or describe block:
process.env.JWT_ALGORITHM = "HS256";
process.env.JWT_SECRET = "test_secret_for_civitasone_32chr";

// Helper to get a test auth header:
const testToken = signToken(
  { sub: "00000000-0000-0000-0000-000000000099",
    tid: "00000000-0000-0000-0000-000000000001",
    roles: ["officer"],
    sid: "test-session" },
  "test_secret_for_civitasone_32chr"
);
const authHeader = { authorization: `Bearer ${testToken}` };

// Then in any route test that was previously unauthenticated, add the header:
// const res = await app.inject({ method: "POST", url: "/...", headers: authHeader, body: {...} });
```

Apply this pattern to ALL existing tests in the service. Do not break existing test assertions —
only add the auth header injection. Tests that already pass a Bearer header should not be changed.

For routes that are `public: true` (sessions login, citizen services GET), do NOT add auth header.

### Step E — Typecheck

After editing all files in a service:
```bash
cd services/{svc} && pnpm typecheck
```

If typecheck fails, fix the errors before moving to the next service. Common fixes:
- Missing `@types/node` → already in workspace devDependencies, should not be needed per service
- `req.routeOptions` type errors → use `(req as any).routeOptions?.config?.public`
- `authPlugin` import not found → check packages/auth/src/plugin.ts exports `authPlugin` as named export

---

## Order to process services
Process in this exact order (dependencies first):
1. Update `packages/auth/src/plugin.ts` first (Step B's plugin change)
2. Then services: identity → policy → audit → notification → finance → procurement →
   contract → hrms → payroll → estab → asset → stock → project → grant →
   citizen → legal → admin → billing

## Validation
After all services are done, run:
```bash
cd /home/ec2-user/CivitasOne/civitasone-suite
pnpm --filter "./services/*" typecheck 2>&1 | grep -E "error|✓|DONE" | head -40
```

Report: for each service — did authPlugin register, did tests still pass, any typecheck errors.
Flag: any service where authPlugin was ALREADY present (already wired).
Flag: any service directory that does not exist yet (still being built by concurrent headless run).
