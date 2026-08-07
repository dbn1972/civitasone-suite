# 01 · Platform group — identity · tenant · policy · admin · gateway · audit · notification · workflow · install · plugins · themes

See `00-MASTER-RUNBOOK.md` for layers, roles, and the EXPECT-FAIL convention.

## Known defects in this group (from gap report — encode as EXPECT-FAIL)

| Ref | Defect | Evidence |
|---|---|---|
| PLT-D1 | Notification bell dead app-wide (gateway prefix `/api/notification` vs FE `notifications`; no `/stream/unread` route; BFF can't stream SSE) | `NotificationBell.tsx:83,131,172,195` |
| PLT-D2 | Entire `/tenant/*` web group unreachable (`/api/v1/tenant` prefix missing) | `tenant/_data.ts:87-109` |
| PLT-D3 | Policy bindings list/create dead (`/policy/bindings` vs `/v1/policy/bindings`, no GET) | `BindingCreateForm.tsx:19` |
| PLT-D4 | Domains UI targets `/v1/admin/domains*`; CRUD lives at `/v1/admin/custom-domains*`; GET is a `[]` stub | `DomainClient.tsx:39-69` |
| PLT-D5 | Webhook "Send test" → no route; data-export plural/singular 404 + fake optimistic row; break-glass Close cross-service id mismatch | `WebhooksClient.tsx:34`, `DataExportClient.tsx:48`, `BreakglassActions.tsx:17` |
| PLT-D6 | `POST /v1/workflow/module-change-requests`, `POST /v1/admin/feedback`, `POST /v1/themes/publish` — no backend routes | ModuleApprovalBanner / FeedbackWidget / ThemeActions |
| PLT-D7 | admin gap-module stubs: sso, idp, mfa, siem, usage, compliance, security-overview, org-hierarchy, domains, data-exports all return hardcoded empties | `admin-service/src/modules/gap/routes.ts:8-67` |
| PLT-D8 | Module-toggle audit fire-and-forget POST `/v1/audit/events` — route doesn't exist (audit silently lost) | `ModuleToggleActions.tsx:56` |
| PLT-D9 | notification conversations routes write DB directly in handlers (CQRS violation, no audit/outbox) | `conversations/routes.ts:78-236` |
| PLT-D10 | audit/plugin/theme consumers have zero idempotency → duplicates on redelivery | consumer files, all three services |

## Checkpoints

### Identity / tenant-admin users
1. [BROWSER] `/tenant-admin/users` lists users; create user → 202 → row appears on refresh.
2. [BROWSER] User detail → "Reset password" (`POST /identity/users/:id/reset-password`) and "Revoke all sessions" (`…/sessions/revoke-all`) → success toast; [API] verify audit events emitted for both.
3. [API] `DELETE /api/identity/sessions/:id` revokes a session; row gone from `/tenant-admin/sessions`.
4. [API] API keys: create (key material shown once), `POST /:id/rotate`, `DELETE /:id`.
5. [API] Auth negative: no token → 401 at gateway on any non-public route; forged HS256 token → rejected (RS256 only).
6. [BROWSER] **EXPECT-FAIL (PLT-D5):** `/tenant-admin/breakglass` → Close button → 404 (admin-DB id posted to identity-service).
7. [CODE] Identity mutations flow through consumers with `emitAudit` (`users/consumer.ts:30-125`).

### Tenant
1. [BROWSER] **EXPECT-FAIL (PLT-D2):** every `/tenant/*` page shows empty/error badge.
2. [API] `GET /api/v1/tenants/current` works (this prefix exists) — returns the seeded tenant.
3. [API] Regression probe for the fix: `GET /api/v1/tenant/settings` currently 404s at gateway; after fix must return tenant settings.
4. [CODE] tenant-service consumers: 7/11 idempotent — extend to all before GO (spot-check `settings` consumer).

### Policy / RBAC
1. [BROWSER] `/policy/evaluate` → POST returns allow/deny for a role+resource pair.
2. [BROWSER] `/policy/role-features`: grant form POST adds a row; `/policy/abac` lists rules.
3. [BROWSER] **EXPECT-FAIL (PLT-D3):** `/policy/bindings` list empty + create 404.
4. [BROWSER] `/tenant-admin/roles`: create role, edit, toggle permission grid — persists after reload.
5. [API] Wrong-role → 403 on a sample of admin endpoints; module disabled via toggle → gateway 403 (module guard V-01).
6. [API] Per-tenant rate limit: burst beyond quota on one tenant → 429; second tenant unaffected.

### Admin / change / settings
1. [BROWSER] `/change`: create request → submit → approve → schedule → start → complete (full transition chain wired).
2. [BROWSER] `/admin/integrations`: list, edit provider/env, approve/reject.
3. [BROWSER] **EXPECT-FAIL (PLT-D5):** webhooks "Send test" no-ops; data-export shows fake "processing" row that vanishes on reload.
4. [BROWSER] **EXPECT-FAIL (PLT-D4):** domain add/verify/delete all 404.
5. [UX] **EXPECT-EMPTY (PLT-D7):** sso/idp/mfa/siem/usage/compliance/org-hierarchy screens show zeros regardless of data — flag as stubs, don't log data defects.
6. [BROWSER] Module toggle as `super_admin` applies immediately; as `tenant_admin` → **EXPECT-FAIL (PLT-D6)** approval submit errors.
7. [CODE] **EXPECT-FAIL (PLT-D8):** confirm module-toggle audit POST 404s silently — mutation-audit rule violated.

### Audit
1. [BROWSER] `/audit/observations`: log → detail → reply → draft-para; `/audit/plan` and `/audit/risk-register` create+list.
2. [BROWSER] `/audit/exports`: create → poll → verify → tokened download link.
3. [API] `GET /api/v1/audit/events` shows events for the mutations you just made (append-only ledger).
4. [CODE] **EXPECT-FAIL (PLT-D10):** redeliver an audit command in staging → duplicate observation row (no idempotency).

### Notifications
1. [BROWSER] **EXPECT-FAIL (PLT-D1):** bell shows no unread count; console logs 404s for `/api/proxy/notifications/…` on every page.
2. [BROWSER] `/notifications/compose`: templates load, send → 202; deliveries detail + resend work.
3. [BROWSER] `/tenant-admin/notifications` pref toggle persists (`PATCH /notification/prefs/:id`).
4. [CODE] **(PLT-D9)** conversation create writes directly in the route handler — verify no audit event exists for it.
5. [API] After PLT-D1 fix: SSE stream delivers a live event; `mark-read` clears unread — and verify the BFF proxy streams rather than buffers.

### Workflow / approvals
1. [BROWSER] `/approvals` lists pending tasks; claim → complete removes task; [API] bulk-complete with multiple ids.
2. [API] SoD: complete your own instance's task → rejected (`tasks/consumer.ts:86-115`).
3. [BROWSER] **EXPECT-FAIL (PLT-D6):** module-change approval submit from tenant-admin settings errors.
4. [CODE] SLA sweeper emits escalation + notification + audit (sweeper.ts) — run twice, assert one-shot.

### Install / plugins / themes
1. [BROWSER] `/install`: stages+steps render; step start/complete via `PATCH /v1/install/steps/:id/:verb`.
2. [BROWSER] `/plugins`: install → enable → disable round-trip refreshes state.
3. [BROWSER] `/themes`: tokens/templates/branding render; **EXPECT-FAIL (PLT-D6):** Publish → 404.
4. [CODE] **(PLT-D10)** plugin/theme consumers lack idempotency — duplicate-install probe under redelivery.
5. [BROWSER] `/setup` sample-data load/remove both succeed (backends verified).

### Gateway (API-layer security spot-checks)
1. [API] Path canonicalisation: `POST /api/v1/crm/public/%2e%2e/contacts` → 400 (not a bearer bypass).
2. [API] `x-internal`/`x-internal-secret` headers from outside are stripped (send them; assert no internal behavior).
3. [API] Public prefixes limited to identity bootstrap, install, careers, crm/public — probe one private route per service without token → 401.
