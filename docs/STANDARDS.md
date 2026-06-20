# CivitasOne Suite — Engineering Standards

**Status:** Binding. Derived from the product volumes (Vol 4 API, Vol 9 Form Validation, Vol 12 QA, Vol 13 Scalability, Vol 14 Integration Testing, Vol 15 Error States) and adapted to this codebase.
**Law of the land:** [`/CLAUDE.md`](../CLAUDE.md) wins on any conflict. This doc expands the *how*.
**Companions:** [ARCHITECTURE.md](ARCHITECTURE.md) · [SECURITY.md](SECURITY.md) · [PERFORMANCE_DESIGN.md](PERFORMANCE_DESIGN.md)

---

## 1. Scope

These standards apply to every service, package, web app, and mobile app in the monorepo. A change that violates a **MUST** is a PR blocker (enforced by `.claude/prompts/07-code-review.md` + CI). **SHOULD** items are reviewed but not auto-blocking.

---

## 2. API standards (Vol 4)

- **Versioned, resource-oriented.** All business endpoints under `/v1/{resource}`. Breaking changes ⇒ new version, never a silent change.
- **CQRS surface (CLAUDE.md §6).** Commands are `POST/PUT/PATCH/DELETE` and return **202 Accepted** `{ id, status:"accepted", correlationId }` (the write is applied by the consumer). Queries are `GET` and return **200** from the cache. A `GET` MUST NOT mutate.
- **Every request** carries `Authorization: Bearer <jwt>` and propagates/echoes `x-correlation-id`. Unauthenticated endpoints exist only if declared public in `policy-service`.
- **Validation at the boundary.** Every body/params/query parsed with `zod` before the handler touches it. No raw `req.body`.
- **Pagination** is cursor-based: `{ data, pagination:{ cursor, hasMore, total?, pageSize } }`.
- **Idempotency.** Every command accepts an idempotency key (defaults to the new resource id); duplicate keys are de-duplicated by the consumer.
- **Uniform error envelope** (also Vol 15):

  ```json
  { "code": "VALIDATION_FAILED", "message": "human readable", "detail": "optional",
    "correlationId": "cor_…", "retryable": false,
    "fieldErrors": [{ "field": "amount", "message": "must be > 0" }] }
  ```

  Canonical `code` values: `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `VALIDATION_FAILED` (400/422), `CONFLICT` (409), `PAYLOAD_TOO_LARGE` (413), `RATE_LIMITED` (429), `INTERNAL` (500, `retryable:true`).
- **OpenAPI is generated** from the route + zod schemas and served at `/openapi.json`. CI fails if the committed spec drifts.
- **Contracts are the source of truth.** Shapes live in `@civitasone/types`; events/commands in `@civitasone/events`. A consumer-driven contract test must cover every cross-service call.

---

## 3. Input & form validation standards (Vol 9)

**Principle:** the backend never trusts the frontend. Validate twice, keep the rules identical, surface errors the same way.

### 3.1 Two-layer, single source

- Frontend (web/mobile) and backend MUST validate with rules that match exactly. Define the rule once as a shared `zod` schema in `@civitasone/types` and import it on both sides where feasible.
- The backend MUST reject an invalid payload **even if the UI is bypassed** (curl, tampered client). Tested explicitly.
- Frontend MUST render backend `fieldErrors` against the right fields, not a generic toast.

### 3.2 Mandatory checks per field class

| Class | Must enforce |
|---|---|
| Required / empty | reject empty, whitespace-only, `null`/`undefined`/`None` strings, omitted keys, unselected required dropdown/checkbox, empty file |
| Length / boundary | min, min−1, max, max+1, and extreme (5k–50k chars) — limits stated in the error |
| Format | email, phone, URL, money (bigint minor units), dates — business-readable error |
| Special chars / Unicode | safely store & re-render `<script>`, `' OR '1'='1`, quotes, emojis, RTL, Hindi/Odia/Bengali/Arabic/Chinese — no XSS, no injection, no broken layout |
| Duplicate / conflict | predictable, specific 409 conflict message (not generic) |
| URL | reject `javascript:`, `data:`, `ftp:`, and SSRF-prone internal hosts (localhost/127.0.0.1/private IPs); require HTTPS where security-sensitive |
| File upload | validate extension AND content/MIME, block double-extension (`x.pdf.exe`), enforce size limit (413), graceful failure, preserve entered metadata on failure |
| Numeric / date | reject negatives/zero where invalid, enforce start≤end, retention bounds, reject tampered dropdown options server-side |

### 3.3 Network-failure behaviour (every form)

For 400/401/403/404/409/413/422/429/500, timeout, offline and slow responses: show a clear message, no blank screen, no infinite spinner, reset the submit button, prevent double-submit, never silently lose entered data, allow safe retry.

### 3.4 Accessibility on forms (WCAG 2.2 AA — see skill 08)

Every input has a visible label/accessible name; errors are programmatically associated and announced; required state announced; keyboard-only works; focus visible; modal forms trap focus and `Esc` closes; colour is never the only error indicator; error contrast meets AA.

> Audit a module's forms with `.claude/prompts/10-form-validation-audit.md`. The reusable rules live in `.claude/skills/10-form-and-input-validation.md`.

---

## 4. Error-state & empty-state standards (Vol 15)

Every screen and surface MUST define all of: **loading**, **empty**, **partial**, **error**, **offline**, **permission-denied**, **not-found**, and **success**. None may be left as a default blank.

- Errors are actionable (what happened + what to do), placed near the cause, never expose stack traces or internal identifiers to end users.
- Loading states are explicit (skeleton/spinner with context); no indefinite spinners — time out to an error with retry.
- Destructive actions require confirmation and state the consequence.
- Empty states explain why it's empty and offer the next action (not just "No data").
- 404/403 pages are branded, in-tenant, and offer a route back.

> Audit with `.claude/prompts/11-error-state-audit.md`.

---

## 5. Testing standards (Vol 12, Vol 14)

- **Unit:** `vitest`, co-located `*.test.ts`, pure domain logic with no I/O.
- **Integration:** `vitest` + `supertest` against an in-memory Fastify app; DB/Redis/queue via testcontainers in CI.
- **Contract:** consumer-driven (e.g. Pact) for every cross-service API and every event a service publishes/consumes — this is what replaces the forbidden shared database.
- **E2E:** `playwright` against staging, including the **form-validation** specs (Vol 9 §Automation) and the **error-state** matrix.
- **Deep integration (Vol 14):** verify cross-service flows go **only** via API or events — a test asserts no service reads another's DB; saga happy-path + each compensating path is covered.
- **Coverage:** ≥ 80% line coverage on changed code. Every PR covers happy path + at least one failure path. No `skip()`/`only()` committed.
- **Selectors** use roles/labels/visible text, not brittle CSS. No random data without cleanup, no sleep-based waits, no retry-masking of real failures.

---

## 6. Quality & scalability gates (Vol 12, Vol 13)

A change is "done" only when all hold on the affected slice:

- typecheck + lint + tests green; coverage ≥ 80% on changed code.
- p95 read < 200 ms, write-ack < 500 ms; reads served via cache, writes via queue (CLAUDE.md §6).
- No N+1 (Drizzle relations/batch loaders); no unbounded query (always paginated/limited).
- WCAG 2.2 AA on changed UI; all eight UI states present.
- Zero cross-service / cross-module joins (L1/L2); audit event on every mutation; `correlationId` everywhere.
- Security: SAST clean of new High/Critical (SECURITY.md); secrets only via env/Vault.
- Targets: 1,000 TPS sustained, 10M users; load-verified with k6 at release gate (`.claude/prompts/08-release-gate.md`).

---

## 7. Observability standards (Vol 3, Vol 12)

Structured JSON logs (pino) only; `correlationId` on every line; OpenTelemetry trace context on every outbound HTTP and queue publish; `/metrics` in Prometheus format; every business event also increments a metric counter. No `console.log`/`console.error` in product code.

---

## 8. Coding standards

- TypeScript strict everywhere; no `any` in exported surfaces — use `@civitasone/types`.
- One Fastify route file = one route group; pure domain logic separated from I/O.
- Money is `bigint` minor units + ISO-4217 code; timestamps `timestamptz` in UTC, displayed in tenant locale.
- Reference other domains by opaque id (`"procurement_po:UUID"`), never a cross-service/cross-module FK.
- No hardcoded secrets, URLs, or environment values. No raw SQL outside Drizzle migrations.
- Smallest correct change; no unrelated refactors; contracts (`@civitasone/types`, `@civitasone/events`) updated in the same PR as any shape change.
