# AGENTS.md

## 1. Purpose

This repository uses AI coding agents for software analysis, development, testing, remediation, review, documentation and pull-request preparation.

All agents must prioritise:

1. Functional correctness
2. Security and privacy
3. Data integrity
4. Tenant isolation
5. User experience and accessibility
6. Performance and reliability
7. Maintainability
8. Backward compatibility
9. Production readiness
10. Evidence-based reporting

Do not treat a successful build as proof that the software is correct.

**Binding companion docs (read before coding):**

* `CLAUDE.md` — stack, architecture, forbidden patterns, CQRS and money rules
* `docs/steering/00-STEERING-INDEX.md` — map of governing docs
* `docs/ARCHITECTURE.md`, `docs/STANDARDS.md`, `docs/SECURITY.md`
* `CONTRIBUTING.md`, `README.md`, `SECURITY.md`

---

## 2. Repository context

### Product

* **Product name:** CivitasOne Suite (`civitasone-suite`)
* **Product type:** Modular, multi-tenant Government ERP and administration platform
* **Primary users:** Government departments, PSUs, autonomous organisations, Section 8 companies, district offices, field offices, municipal organisations and other public institutions
* **Architecture:** API-first microservices, DB-per-service, CQRS (queue-first writes), transactional outbox, event-driven integrations, configurable workflows
* **Monorepo layout:**
  * `apps/web` — Next.js 14 App Router
  * `apps/mobile` — Flutter
  * `services/*-service` — Fastify + TypeScript domain services
  * `packages/*` — shared libraries (`auth`, `db`, `queue`, `events`, `cache`, `types`, `ui-kit`, …)
  * `infra/` — Docker Compose, Keycloak, LocalStack, observability, Helm/Terraform
  * `tests/` — contract, integration, e2e-live, e2e-personas, security, verification
  * `scripts/` — migrate, seed, readiness, CI guards, ops
* **Deployment models:** Shared SaaS, isolated tenant (silo), on-premises and cloud
* **Primary concerns:** Security, tenant isolation (RLS), auditability, accessibility (GIGW), data integrity, GFR/government process compliance, DPDP / CERT-In

### Stack (non-negotiable)

| Layer | Tech |
|---|---|
| Backend | Node 20+, Fastify 4, TypeScript strict, Drizzle ORM |
| Database | PostgreSQL 16 — **one database per service** |
| Cache | Redis 7 via `@civitasone/cache` |
| Queue | `@civitasone/queue` only (SQS / Kafka / RabbitMQ adapters) |
| Auth | Keycloak OIDC + JWT via `@civitasone/auth` (RS256 in production) |
| Web | Next.js 14, React 18, Tailwind, `@civitasone/ui-kit` only |
| Mobile | Flutter 3.22+, Riverpod, go_router, Dio |
| Tooling | pnpm 9 workspaces + Turborepo |

### Services present in this repository

Inspect `services/` before assuming implementation depth. Current service folders include:

**Platform / control plane**

* `gateway-service`, `queue-service`, `identity-service`, `tenant-service`, `policy-service`, `admin-service`, `install-service`, `plugin-service`, `theme-service`, `metadata-service`

**Core ERP**

* `finance-service`, `procurement-service`, `contract-service`, `inventory-service`, `stock-service`, `asset-service`, `payroll-service`, `hrms-service`, `project-service`, `grant-service`, `works-service`, `revenue-service`, `billing-service`

**Government / office**

* `estab-service` (eOffice / file movement), `workflow-service`, `meeting-service`, `court-service`, `legal-service`, `audit-service`, `visitor-service`, `inspection-service`

**Citizen / CRM / ops**

* `citizen-service`, `crm-service`, `helpdesk-service`, `notification-service`, `telephony-service`, `knowledge-service`, `location-service`, `report-service`, `analytics-service`, `cdp-service`, `catalogue-service`, `loyalty-service`, `field-service`, `journey-service`, `recommendation-service`, `ai-agent-service`, `ml-service`

Agents must inspect each target service’s `src/modules/`, migrations, tests and web screens under `apps/web` before claiming completeness. Module counts and CQRS depth vary widely.

### In-service module layout (L2)

Each service owns bounded contexts under:

```text
services/<name>-service/src/modules/<module>/
  schema.ts | domain.ts | commands.ts | consumer.ts | repo.ts | queries.ts | routes.ts
```

Cross-module data stays inside the service via domain interfaces or events — **no JOINs across module schemas**. Cross-service data goes via HTTP (reads) or queue events (writes).

---

## 3. Repository-specific commands

Before running commands, inspect `README.md`, `CONTRIBUTING.md`, `package.json`, `infra/docker-compose.yml`, `.github/workflows/` and service-level `package.json` files. Prefer repository scripts.

```bash
# Install dependencies
pnpm install

# Start local infrastructure (Postgres, Redis, Keycloak, LocalStack)
docker compose -p civitasone --env-file infra/.env -f infra/docker-compose.yml up -d

# Optional: start the PM2 / local stack helpers
bash scripts/dev/start-stack.sh
bash scripts/dev/verify-live-stack.sh

# Apply all service migrations
node scripts/dev/migrate-all.mjs

# Seed (dev only)
node scripts/dev/seed-all.mjs

# Build (Turborepo)
pnpm build
# Single package / service
pnpm --filter @civitasone/<package-or-service> build

# Format check
pnpm exec prettier --check .

# Lint
pnpm lint
# or
pnpm turbo run lint

# Type check
pnpm typecheck

# Unit / service tests
pnpm test
pnpm test:services
pnpm test:packages
pnpm --filter @civitasone/<service-name> test
pnpm --filter @civitasone/<service-name> exec vitest run --coverage

# Integration tests
pnpm test:integration

# Contract / screen contracts
pnpm test:contract
pnpm test:screens
pnpm verify-screens

# End-to-end tests
pnpm test:e2e:personas
pnpm test:e2e-live

# Architecture / security / readiness guards
pnpm arch:guard
pnpm guard:schema-drift
pnpm guard:ci-config
pnpm guard:ledger-poison
node scripts/production-readiness-score.mjs
pnpm qa:score
pnpm ci:check

# Dependency / secret style checks (CI scripts)
node scripts/ci/dependency-audit.mjs
# Secret scanning is enforced in CI — never commit .env, keys, or PEM files

# Container / compose
docker compose -p civitasone --env-file infra/.env -f infra/docker-compose.yml build
# Production compose reference: infra/docker-compose.prod.yml

# Runtime on the shared EC2/dev host (when authorised)
pm2 list
curl -sS http://127.0.0.1:8080/ready
curl -sS http://127.0.0.1:8080/health
```

Filter package names follow `@civitasone/<folder>` (for example `@civitasone/finance-service`, `@civitasone/web`). Confirm in each package’s `package.json`.

Do not invent commands when repository scripts are available.

---

## 4. Mandatory repository safety rules

Before changing any file:

1. Confirm the repository root (`civitasone-suite`).
2. Inspect the active branch (`git branch --show-current`).
3. Run `git status`.
4. Identify uncommitted and untracked files.
5. Identify repository-specific instructions (`CLAUDE.md`, steering docs).
6. Identify the target service/module and dependent services.
7. Run relevant baseline tests.
8. Record existing failures before making changes.

### Shared-host / worktree rule (critical)

On the shared `cloudsphere-ec2` checkout, **`main` may be hard-reset on a short interval**. Never edit uncommitted work directly under `/home/ec2-user/CivitasOne/civitasone-suite` on `main`.

For every assignment:

1. `git fetch origin main`
2. Create a **dedicated git worktree** under `/home/ec2-user/wt/<short-name>` from `origin/main`
3. Create / use a feature branch in that worktree
4. Commit early and often
5. Push the branch, open a PR, wait for checks, then merge

Never:

* Commit directly to `main`, `master` or another protected branch
* Discard unrelated user changes
* Use `git reset --hard` on branches that contain work you do not own
* Force-push
* Rewrite shared history
* Delete files only to make tests pass
* Disable security controls, RLS, auth plugins or queue production guards
* Suppress test failures without investigation
* Access production without explicit written authorisation
* Modify production data
* Commit credentials, tokens, private keys, PII keys or personal data
* Run destructive database commands without explicit authorisation
* Write to Postgres from route handlers (CQRS violation)
* Store money as floating point
* Trust client-supplied `x-tenant-id` — tenant must come from verified JWT claims (gateway overwrites)

Preserve existing work.

---

## 5. Branching, PR and merge — mandatory for every change

**Every material change MUST use a new branch, a pull request, and a merge. No exceptions for “small” edits, docs-only changes, or agent-authored work.**

### Branch formats

```text
ai/quality-<module>-<date>
ai/fix-<issue-or-defect-id>
ai/feature-<feature>
ai/security-<module>
docs/<topic>-<date>
fix/<defect-id>-<slug>
```

Examples:

```text
ai/quality-procurement-20260801
ai/fix-payroll-rounding
ai/security-tenant-isolation
docs/agents-md-civitasone-20260801
fix/def-lm-002-leave-overlap
```

### Required sequence (every assignment)

```text
1. Discover + baseline on a clean worktree from origin/main
2. Create branch
3. Implement with tests
4. Validate (typecheck / lint / focused tests / applicable guards)
5. Commit with conventional message(s)
6. Push branch: git push -u origin HEAD
7. Open PR with the template in §15
8. Ensure CI / required checks pass
9. Independent review / gatekeeper pass
10. Merge via GitHub (merge commit or repo-default); delete branch
11. Pull/ff main in worktrees only after merge
```

Keep changes limited to the requested scope and required dependencies.

Do not include unrelated formatting, dependency upgrades or refactoring in the same pull request.

Do not leave finished work only on a local branch. If the task is complete, the PR must exist. If merge is blocked, report the blocker — do not bypass branch protection.

---

## 6. Standard execution workflow

Every material assignment must follow these phases.

### Phase 1: Discover

Inspect:

* Service entry (`services/<svc>/src/app.ts`, `worker.ts`)
* Modules under `src/modules/*`
* Migrations under `services/<svc>/migrations/`
* Web screens under `apps/web/src/app/**`
* APIs / OpenAPI via ops routes
* Events (`packages/events`, outbox publishers/consumers)
* Queue topics and consumers
* RLS policies in SQL migrations
* Roles / policy-service bindings
* External adapters (`services/adapters/**`)
* Tests (unit, integration, contract, verification, e2e)
* `ecosystem.config.js` / PM2 / compose deployment config
* Existing audits under `docs/`, `erp-assessment/`, `audit-results/`

Trace at least one complete workflow: route → zod validate → `sendAccepted` / queue → consumer → DB + outbox → downstream event → cache invalidate → audit.

### Phase 2: Understand requirements

Determine expected behaviour from:

* Requirement / verification checklists (for example HRMS ATS checklist)
* Steering docs and `docs/`
* Existing tests and contract baselines
* API schemas (zod) and DB constraints
* UI loaders under `apps/web/src/app/_data/`
* Issue / PR history

Classify requirements as Confirmed / Inferred with evidence / Assumed / Unresolved.

Do not invent government rules (GFR, CCS, EPFO, GST, RTI, etc.) without a repository or cited source.

### Phase 3: Establish baseline

Before modifying code:

* Run relevant service tests and typecheck
* Record current failures
* Confirm reproducibility
* Note PM2 / `/ready` state only when working against a live stack you are authorised to use

### Phase 4: Assess

Evaluate functional defects, missing functionality, security, authorisation, tenant isolation, data integrity, API consistency, UX/a11y, performance, reliability, CQRS/outbox compliance, deployment and observability gaps.

### Phase 5: Triage

Validate, reproduce, severity-rate, root-cause, define regression test and safest correction. Reject unsupported findings.

### Phase 6: Fix

1. Add or identify a failing test.
2. Correct the root cause (prefer consumer/domain/migration — not route-layer DB writes).
3. Run focused tests, then module/service tests, then relevant integration/contract tests.
4. Verify reproduction is fixed.
5. Update docs when behaviour changes.

Prefer small, clear, maintainable corrections. Money as `bigint` paise. Zod at boundaries. Idempotent consumers (`markProcessed`).

### Phase 7: Full validation

Run all applicable checks from §3 (`typecheck`, `lint`, `test`, `test:integration`, `test:contract`, `arch:guard`, coverage on touched service ≥ 80% lines, migration validation, security-sensitive suites).

### Phase 8: Independent review

A reviewer that did not author the main correction must inspect the full diff for security, tenant isolation, permissions, migrations, backward compatibility, logging and rollback.

### Phase 9: Pull request and merge

Create the PR only after review and tests. Merge only when §16 gates pass. Then delete the remote feature branch.

---

## 7. Multi-agent responsibilities

Use parallel agents where supported. When unavailable, perform independent sequential review passes.

### Orchestrator

Scope, work allocation, conflict prevention, findings register, test plan, **branch / PR / merge control**, final quality decision.

### Product and functional agent

Business purpose, roles, end-to-end workflows, state transitions, validation, negative paths, government process alignment.

### API and integration agent

Contracts, zod validation, status codes (`202` for commands), pagination, idempotency, events, queues, upstream gateway aliases, backward compatibility.

### Database and data-integrity agent

Drizzle schemas, SQL migrations (additive, `IF NOT EXISTS`, `lock_timeout`), RLS/`FORCE RLS`, transactions, bigint money, concurrent updates, outbox, indexes, **no cross-service or cross-module JOINs**.

### Security and privacy agent

Authn/authz, object-level access, cross-tenant access, JWT/`x-internal`/`x-service-secret`, injection/XSS/SSRF, file upload/download, rate limits, PII encryption (`encryptedText` / service PII keys), secret handling, audit logs, DPDP retention/deletion.

Security testing must remain defensive and limited to authorised environments.

### UX and accessibility agent

Navigation, forms, empty/loading/error states, PermissionDenied, keyboard/focus, contrast, GIGW bilingual expectations (do not claim i18n is complete unless wired), WCAG AA baseline when unspecified.

### Performance and reliability agent

Cache-first reads, queue-first writes, p95 targets (reads < 200ms, writes < 500ms), N+1, pool use, queue backlog, retry/DLQ, graceful degradation. No uncontrolled load tests on shared infra.

### Architecture and code-quality agent

Service/module boundaries, dependency direction, duplication, type safety, Fastify conventions, forbidden patterns from `CLAUDE.md`.

### Test automation agent

Unit, service, API, integration, contract, e2e, security, permission, tenant-isolation, data-integrity, concurrency tests. Every fixed defect needs a regression test unless documented impossible. No committed `skip()` / `only()`.

### DevOps and production-readiness agent

CI workflows, compose/Helm, secrets, health/readiness (`/health`, gateway `/ready`), migrations, rollback (`scripts/rollback.sh`), metrics/logs/correlation IDs, backup/DR impact, feature flags, PM2 `ecosystem.config.js` (never ship HS256/dev secrets to real production).

### Independent gatekeeper

Must not author the primary correction. Must challenge root-cause fit, test strength, permission/tenant integrity, data corruption risk, unrelated diffs and merge safety.

---

## 8. Finding format

```text
Finding ID:
Title:
Category:
Severity:
Confidence:
Affected component:
Expected behaviour:
Observed behaviour:
Reproduction steps:
Evidence:
Root cause:
Business impact:
Security or data impact:
Recommended correction:
Required regression test:
Fix status:
Verification status:
```

### Severity definitions

#### Critical

Cross-tenant access; authentication bypass; RCE; major personal-data exposure; irrecoverable data corruption; material financial misstatement; complete outage of a critical service.

#### High

Privilege escalation; serious authorisation defect; major workflow failure; significant data-integrity risk; major business process unavailable; severe production instability.

#### Medium

Important defect with workaround; missing validation; accessibility barrier; moderate performance issue; incomplete error handling; material maintainability problem; CQRS/cache bypass without exploit.

#### Low

Minor UI inconsistency; cosmetic issue; small usability problem; low-risk technical debt.

Do not exaggerate severity.

---

## 9. CivitasOne-specific quality requirements

### Tenant isolation

Verify tenant context at API, service, DB (RLS GUC), cache keys, search indexes, object storage, background jobs, events, reports, exports and audit logs.

Never rely only on a client-supplied tenant identifier. Gateway must overwrite `x-tenant-id` from JWT `tid`.

Negative tests must prove Tenant A cannot access Tenant B records, documents, reports, search hits, notifications, workflow tasks or audit data.

### Authorisation

Server-side enforcement for create/view/update/delete/approve/reject/forward/cancel/export/download/assign/reassign/close/reopen/administer. UI hiding is not authorisation.

### Auditability

Mutations emit audit via outbox/`@civitasone/events` with actor, tenant, action, entity, before/after (as appropriate), timestamp, correlation id, channel, success/failure. Never log passwords, tokens or unnecessary PII.

### CQRS / queue integrity

* Routes: validate → enqueue command → `202 Accepted`
* Consumers: idempotent apply → outbox → events → cache invalidate
* Production must not use in-memory queue drivers
* Workers must be deployed alongside API processes for CQRS services

### Workflow integrity

Valid/invalid transitions, duplicate approval, unauthorised approval, delegation, escalation, SLA, cancellation, reopen, parallel/sequential approval, event replay, retry/DLQ.

### Financial integrity (finance, payroll, procurement, contracts, billing, revenue, grants)

* `bigint` minor units + ISO currency
* Rounding, tax, duplicate payment prevention, idempotency, reversal, cancellation, reconciliation, journal balance (`Dr == Cr`), budget/commitment controls, concurrent submissions
* Immutable financial audit trails; period-close enforcement

### Government file and case integrity (estab, legal, court)

Preserve chronology, numbering, notings/correspondence, custody/movement, hearings/decisions, signatures, version history; approved/final artefacts immutable or formally versioned; hash-chained notings where implemented.

### PII / DPDP

Sensitive columns use encryption helpers; service-specific PII keys via env; fail closed when keys missing in non-test environments.

---

## 10. Testing expectations

Do not target coverage percentages alone. Still enforce **≥ 80% line coverage on touched service code**.

Prioritise behavioural coverage of authentication, authorisation, tenant isolation, financial calculations, state transitions, migrations, audit logging, idempotency, concurrency and external integration failure.

Tests must be deterministic, independent, repeatable, readable and capable of failing when the defect returns.

Never weaken assertions only to make tests pass. Do not disable a failing test without documenting why it is invalid.

---

## 11. Coding standards

Follow `CLAUDE.md` and `docs/STANDARDS.md`.

* Clear names; focused functions; zod at every external boundary
* Structured errors; preserve TypeScript strictness; no `any` exports
* No `console.log` in production code — use Fastify/`pino` loggers
* No hidden side effects; no unnecessary dependencies
* No duplicate business rules across services
* Transactions for atomic DB work inside consumers
* Idempotency for retryable commands
* Correlation IDs across HTTP and queue boundaries
* Preserve API compatibility where possible
* Web uses ui-kit; no direct DB from `apps/web` or `apps/mobile`

---

## 12. Database migration rules

For every migration in `services/<svc>/migrations/`:

1. Additive and idempotent (`IF NOT EXISTS` / safe guards).
2. Set `lock_timeout` appropriately.
3. Enable RLS + `FORCE RLS` on new tenant tables.
4. Confirm backward compatibility and staged expand/contract for breaking changes.
5. Test against representative data when touching financial/HR tables.
6. Assess locking and execution time.
7. Do not drop columns in the same release as dependent app removal unless explicitly approved.
8. Do not add mandatory columns without defaults or a staged deployment plan.
9. No cross-service FKs; reference opaque IDs only.
10. Document operational sequencing in the PR.

Apply locally with `node scripts/dev/migrate-all.mjs` or the service’s migration runner.

---

## 13. Security rules

Never commit passwords, tokens, API keys, private keys, database credentials, session cookies, personal data, production `.env`, or PII encryption keys (including `.civitasone-*-key` files).

Use environment variables / approved secret managers.

When a secret is discovered: do not repeat it; record file + type; stop propagation; recommend rotation; remove from the change; escalate.

Do not generate exploit instructions beyond what is required to prove and fix an authorised finding.

---

## 14. Commit requirements

Use focused conventional commits:

```text
type(scope): description
```

Examples:

```text
fix(auth): enforce tenant-scoped resource access
fix(finance): prevent duplicate payment posting
fix(workflow): reject invalid approval transitions
test(procurement): cover concurrent bid submission
perf(search): remove repeated database queries
docs(agents): add CivitasOne AGENTS.md operating rules
```

Do not combine unrelated changes into one commit.

---

## 15. Pull-request requirements

Every pull request must include:

### Summary

What was reviewed and changed.

### Business impact

Why the correction matters.

### Findings resolved

Finding IDs and concise explanations.

### Technical changes

Important implementation decisions (CQRS, RLS, migrations, events).

### Tests performed

Exact commands and results.

### Security impact

Authn/authz, tenant, PII, logging changes.

### Database impact

Schema, migration, data and rollback considerations.

### UX impact

Visible behaviour and accessibility changes.

### Deployment considerations

Config, sequencing, feature flags, worker/PM2 restart needs, rollback.

### Remaining risks

Anything unresolved or not tested.

### Checklist

```text
[ ] New branch created from latest origin/main (worktree on shared hosts)
[ ] Scope limited to requested module and required dependencies
[ ] No unrelated user changes overwritten
[ ] No secrets committed
[ ] Formatting / lint / typecheck pass for touched packages
[ ] Build passes for touched packages
[ ] Unit / service tests pass
[ ] Integration / contract tests run when cross-service behaviour changes
[ ] Critical e2e workflows considered or executed
[ ] Security and tenant-isolation tests pass where applicable
[ ] Database migration validated
[ ] Accessibility-critical paths checked when UI changes
[ ] Performance smoke considered for hot paths
[ ] Documentation updated
[ ] Rollback documented
[ ] No unresolved Critical or High finding remains
[ ] Independent review passed
[ ] PR opened; CI green; merge completed or blocker reported
```

---

## 16. Merge rules

**Default agent behaviour: after a green PR and gatekeeper approval, merge the PR** (using `gh pr merge` with the repository’s allowed strategy). If human approval or branch protection blocks merge, leave the PR ready and report the blocker clearly.

Merge is permitted only when:

* CI passes
* Build / required tests pass
* Security checks pass
* No Critical or unresolved High finding remains
* No unresolved review thread remains
* No secret is present
* Tenant-isolation tests pass where applicable
* Database migration is safe
* Backward compatibility is assessed
* Required approvals are obtained
* Independent gatekeeper approves
* Branch protection permits the merge

Do not bypass branch protection. Do not use administrator override to ignore failed checks unless the task explicitly authorises it and the risk is documented.

After merge: delete the feature branch; do not keep long-lived agent branches.

---

## 17. Stop conditions

Stop making changes and report when:

* Production is the only available test environment
* Critical requirements are materially ambiguous
* Necessary credentials are unavailable
* Destructive migration is required
* Unrelated uncommitted work cannot be safely isolated
* A secret or serious data exposure is discovered
* Tests require unauthorised access
* A correction would break a published API without a versioning plan
* A material security risk cannot be safely fixed
* Required verification cannot be completed
* Shared `main` worktree hygiene would be violated (use a new worktree instead)

Do not claim completion when material validation remains incomplete.

---

## 18. Final response format

At completion, return:

```text
Overall result:
Module:
Branch:
Pull request:
Merge status:
Quality status: Pass / Conditional Pass / Fail
Release recommendation: Ready / Ready with accepted risks / Not ready

Findings:
Critical:
High:
Medium:
Low:
Fixed:
Remaining:

Main corrections:
- ...

Validation:
Build:
Lint:
Type check:
Unit tests:
Integration tests:
End-to-end tests:
Security:
Tenant isolation:
Accessibility:
Performance:
CI:

Files changed:
- ...

Remaining risks:
- ...

Evidence:
- Commands run
- Test results
- Report locations

Merge decision:
Merged / PR ready but not merged / PR not ready
```

Be accurate. Never state that a test passed unless it was actually executed successfully.
