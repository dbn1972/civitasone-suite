# Workflow Prompt — Code Review

**Use when:** Reviewing a PR. This prompt runs automatically via GitHub Action on every PR.

---

## Inputs

```
PR NUMBER: {{number}}
PR TITLE: {{title}}
PR DESCRIPTION: {{body}}
DIFF: {{full unified diff}}
CHANGED FILES: {{list}}
LINKED ISSUE: {{issue link}}
```

---

## Review checklist (Claude must evaluate each item)

For each finding, output: `severity | file:line | rule | description | suggested fix`.

Severity scale: BLOCKER (must fix) | MAJOR (should fix) | MINOR (nice to fix) | NIT (style).

### A. Architecture & boundaries (BLOCKER if violated)

- [ ] Every new table prefixed with the owning service name
- [ ] Zero SQL joins across service prefixes
- [ ] Zero direct DB access from another service's code
- [ ] All cross-service writes go through `@civitasone/queue`
- [ ] No mutation in a `GET` handler
- [ ] No new endpoint in `apps/web` (always in `services/`)

### B. Multi-tenancy & isolation (BLOCKER)

- [ ] Every table has `tenant_id`
- [ ] Every query filters by `tenant_id` (Drizzle relation or explicit WHERE)
- [ ] No cross-tenant data access without explicit support-mode break-glass + audit event
- [ ] Row-level security policy created for new tables

### C. Auth & authorization (BLOCKER)

- [ ] Every new endpoint authenticated unless explicitly marked public with PR justification
- [ ] Every endpoint mapped to a permission key in `policy-service`
- [ ] JWT verification via `@civitasone/auth` only (no custom verification)
- [ ] No hardcoded role checks (must use policy-service evaluate API)

### D. Validation & inputs (BLOCKER)

- [ ] Every input validated with zod at the route boundary
- [ ] No raw `req.body` / `req.query` / `req.params` access without zod parse
- [ ] Numeric limits, string maxlength, enum constraints enforced

### E. Audit & observability (BLOCKER)

- [ ] Every mutation emits an audit event via `@civitasone/events`
- [ ] Every log line includes `correlationId`
- [ ] Structured logging only (no `console.log` in production code)
- [ ] Errors logged with `server.log.error({ err }, "...")` not `console.error`

### F. Data integrity (MAJOR)

- [ ] Money stored as `bigint` minor units + ISO currency
- [ ] Timestamps as `timestamptz` and UTC
- [ ] IDs as UUID v7 (never auto-increment)
- [ ] Idempotency keys honored on POST mutations

### G. Tests (BLOCKER)

- [ ] Happy path test present
- [ ] At least one failure path test present
- [ ] Coverage of changed lines ≥ 80% (CI metric)
- [ ] No `.only` or `.skip` in committed tests
- [ ] No real network calls in unit tests (mock)

### H. Performance (MAJOR)

- [ ] No N+1 queries introduced (look for `.map(async ...)` calling DB)
- [ ] Read-heavy endpoint consults cache (Redis) before DB
- [ ] Indexes added for new query patterns
- [ ] No synchronous heavy work on hot path

### I. Security (BLOCKER if found)

- [ ] No hardcoded secrets, API keys, URLs
- [ ] No SQL injection surface (raw SQL banned outside migrations)
- [ ] No exposed stack traces in API responses
- [ ] CSP/HSTS/security headers not regressed
- [ ] Rate limit applied to new public endpoints

### J. UI (web) — when diff touches apps/web (MAJOR)

- [ ] Uses only ui-kit components — no inline styles, no hex literals
- [ ] All states present: default, loading, empty, error, success
- [ ] axe-core passes (CI metric)
- [ ] All strings via next-intl, no hardcoded copy
- [ ] Server components for data fetching, client only where needed

### K. Documentation (MINOR)

- [ ] If contract changed: `@civitasone/types` or `@civitasone/events` updated in same PR
- [ ] If new permission added: registered in policy-service migration
- [ ] If new env var: added to `.env.example`
- [ ] If new dependency: added to `package.json` with version pin

---

## Output format

```
PR REVIEW — #{{number}}

VERDICT: APPROVE | REQUEST_CHANGES | COMMENT

BLOCKERS (must fix before merge):
- {{severity}} | {{file:line}} | {{rule}} | {{description}} | {{fix}}
- ...

MAJORS (should fix):
- ...

MINORS (nice to fix):
- ...

POSITIVES (call out good practices):
- ...

SUGGESTED PR DESCRIPTION ADDITIONS (if missing context):
- ...
```

The GitHub Action posts this as a PR review. If any BLOCKER present → request changes. Else approve with comments.
