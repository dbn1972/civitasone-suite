# Skill — Release Engineering

**When to load:** Before cutting a release, changing `ecosystem.config.js` or any deploy/rollback script, adding a new service's secrets, or touching `.github/workflows/release.yml` / `scripts/ci/release-gate.mjs`.

---

## The rule

> A release is not "shipped" because CI is green. It is shipped when the evidence-gated release process says so, deployed with a rollback path that has actually been exercised, and every secret it needs fails closed rather than falling back to a dev default.

## 1. The two-gate release model — don't confuse them

There are **two separate gates**, and conflating them is the most common mistake:

- **`.github/workflows/release.yml`** (the CI job) does *not* re-run tests. It (a) verifies CI already passed on this exact SHA via `gh run list --commit "$SHA" --workflow ci.yml`, (b) runs `node scripts/qa-readiness-score.mjs --min-score 95`, (c) runs `node scripts/production-readiness-score.mjs`, (d) probes the staging gateway's `/health`, then creates a GitHub release (`gh release create "v${VERSION}" --generate-notes`) reading `VERSION` from root `package.json`.
- **`scripts/ci/release-gate.mjs`** is a *different*, evidence-based gate: it never re-runs tests either — it audits JUnit evidence already written to `evidence/<date>/` by prior CI runs, and is explicit that missing evidence is a failure, not a pass: `// Exit 0 = releasable. Exit 1 = blocked. Never exits 0 on missing evidence.` It splits lanes into `REQUIRED_LANES` (block the release if `UNMEASURED` or `FAIL`: L0 Deployment Readiness, L1 Tenant Isolation, L2 Authz/BOLA, L3 Data & Schema Integrity, L4 API Contract & Input, L6 Security, L10 Domain Correctness, L11 Mutation & Canary — all P0/P1/META) and `ADVISORY_LANES` (reported but non-blocking: L7 Reliability, L8 AI Features).

**Before claiming a release is safe, check evidence exists for every `REQUIRED_LANES` entry** — a lane silently missing evidence is functionally the same failure mode as `scopedRead` inside an open transaction in skill 16: it *looks* covered because a name exists in the pipeline, but nothing actually ran.

## 2. Versioning & changelog discipline

- Root `package.json` carries a single version (`0.1.0` at time of writing) that `release.yml` reads for the tag name. **`git tag` currently returns zero tags** — no release has ever actually been cut through this pipeline yet, despite the workflow assuming `gh release create "v${VERSION}"` will succeed. The first real release through this path needs to bootstrap tag state, not assume it.
- `.releaserc.json` (semantic-release config: commit-analyzer, release-notes-generator, npm plugin with `npmPublish: false`, GitHub plugin) is configured but **no workflow file actually invokes `semantic-release`** — it is dormant config, not a running process. Don't assume version bumps happen automatically because this file exists.
- Root `CHANGELOG.md` follows Keep a Changelog + SemVer and is actively maintained with real entries — this is the source of truth for what shipped, keep it current on every user-visible change.
- **Every `@civitasone/*` shared package requires its own changelog entry and version bump for any change** — `packages/cache/CHANGELOG.md` states this explicitly and documents a real breaking change (`CacheStore.incr` added because `getOrLoad`'s read-modify-write/stampede-coalescing semantics were unsafe for counting, which had left a rate limiter bypassable in crm-service's lead-capture endpoint). A shared-package change with no changelog entry is a red flag that downstream blast radius wasn't considered.
- `docs/uat/CHANGELOG.md` is a *separate*, UAT-wave-scoped changelog: each wave gets a Bugs Fixed table (`# | Bug | Files Touched | User-Visible Change`), a Tests Added table, a **Manual UAT Verification Needed** checklist, and a **Risk Areas** section stating blast radius per shared-package change in plain language (e.g. `packages/db — tenantTransaction added. Only finance-service uses it. Others unchanged.`). Write this Risk Areas line for any shared-package or cross-service change — it is what lets a reviewer judge blast radius without reading the diff.

## 3. Database migration safety at deploy time

`scripts/ci/bootstrap-postgres.sh` (558 lines) is the richest incident record in the repo for this — read a wide sample of its inline comments before writing a new migration, not just the SQL itself. Real, dated failure classes preserved there as comments:

- **Wrong maintenance database**: `psql` defaults dbname to the connecting username; no image creates a `civitas` database, so a bare bootstrap died on `FATAL: database "civitas" does not exist` before applying a single migration, taking the whole CI Tests job down with it. Always target the portable `postgres` maintenance DB for cluster-level bootstrap statements.
- **Role-ordering dependency**: several bootstrap files depend on `civitas_admin` existing but nothing created it first, so the script aborted with `role "civitas_admin" does not exist"` and every later step ran against an empty database — invisible on dev machines because the role existed there by hand, outside version control. **A role/DB provisioning step with an implicit ordering dependency on another step is a real, recurring bug shape here** — make dependencies explicit and ordered, never assumed.
- **"Declared but never provisioned"** is the single most repeated bug class in this file — a service is wired into `ecosystem.config.js` and the gateway registry, has real migrations, but no bootstrap file ever created its role/database, so every migration failed to authenticate (indistinguishable from a wrong password) or failed with `database does not exist`. This has independently hit refund-service, court/meeting/visitor-service (all three "appeared in NO bootstrap file at all"), inspection-service, the sec5-batch-3 municipal services, swm-service, shop-service, recommendation-service (1172 tests sat passing-but-never-run in CI once this was found), sewerage-service, ai-agent-service, and building-service. **When adding a new service, grep the bootstrap script for its role/DB name before assuming CI will provision it — do not assume "it's in `ecosystem.config.js`" is sufficient evidence it's wired end to end.**
- **Near-identical filenames diverging silently**: `scripts/ci/bootstrap-remaining-services.sql` (hyphens) and `infra/db/bootstrap/bootstrap_remaining_services.sql` (underscores) are two different files — the naming collision is how the second one became orphaned and unreferenced. Check for a near-duplicate name before assuming a new bootstrap file will actually get invoked.
- **Schema-existence ordering**: measured against a throwaway container, `schema "X" does not exist` was the largest single cause of migration failure (30 of 97) — schema-creation statements must run before any migration that references that schema, every time, not just in the order files happen to sort.
- **No rollback-of-a-bad-migration procedure exists.** The entire bootstrap script is about *idempotent provisioning* (safe to re-run from empty), not about rolling back a migration that already ran and turned out to be wrong. If a migration ships a real defect, there is currently no scripted "undo migration N" path — this needs a human-reviewed forward-fix migration, or manual DBA intervention. Treat this as a known gap, not a solved problem, when planning a risky migration.

## 4. Feature flags

A real feature-flag system exists in `admin-service` (`src/modules/feature-flags/`: commands, routes, schema, consumer) plus a standalone `packages/feature-flags/` package with its own test suite, and tenant-scoped flag-override surface in `tenant-service` (`schema.ts`, `tenant-extensions/routes.ts`). Use this system for any staged/canary rollout of new behavior rather than an ad hoc environment variable — env-var-gated behavior doesn't get per-tenant granularity or a UI-driven kill switch.

## 5. Deployment & rollback — know the actual blast radius of `pm2 restart all`

`scripts/deployment-runbook.md` documents the real procedure in four steps: **snapshot** (`tar -czf ~/civitas-backups/civitas-snapshot-$(date +%Y%m%d-%H%M%S).tgz ...` before touching anything), **deploy** (`git pull && pnpm build && pm2 restart all && pm2 save`), **verify** (`pm2 list | grep online | wc -l` expecting 51+, plus a gateway health curl), **rollback** (`bash scripts/rollback.sh`, which untars the latest snapshot over the checkout, rebuilds, and `pm2 restart all` again).

Two things worth internalizing before treating a deploy as routine:

- **`pm2 restart all` is a hard stop-then-start across the entire fleet, not a rolling/zero-downtime restart.** Confirmed directly in `ecosystem.config.js`: the `svc()`/`worker()` factory functions that generate every one of the ~50 service and worker PM2 entries set only `restart_delay` and `max_restarts` — there is no `wait_ready`, `listen_timeout`, or `kill_timeout` anywhere in the 689-line file. There is no blue-green or canary deployment infrastructure anywhere in this repo. A deploy is a brief full-fleet outage, not a graceful cutover — plan the deploy window accordingly, and don't assume in-flight requests survive a deploy.
- **A boot-probe "failure" is not automatically a real defect** — one dated comment in `ecosystem.config.js` documents a false alarm: a 2026-07-27 boot probe reported a failure that was actually caused by the probe's own hand-built env missing required vars, not a config defect. Verify a reported deploy failure against the actual env/config before "fixing" something that isn't broken.

## 6. Secrets at release time — the fail-closed convention

Every secret-bearing service in `ecosystem.config.js` follows the same shape, built around `IS_PROD = (process.env.NODE_ENV ?? "production") === "production"` and a `requireSecret(name)` helper that throws when `IS_PROD` and the value is empty:

```js
const INTERNAL_SERVICE_SECRET = requireSecret("INTERNAL_SERVICE_SECRET"); // unconditional
const DEVICE_TRUST_SECRET = IS_PROD ? requireSecret("DEVICE_TRUST_SECRET") : (process.env.DEVICE_TRUST_SECRET ?? "civitasone-device-trust-dev-secret");
const JWT_SECRET = IS_PROD ? undefined : (process.env.JWT_SECRET ?? "civitasone-dev-secret");
```

The same pattern repeats per-service for `VISITOR_TENANT_SIGNING_KEY_PEM`, `PII_ENC_KEY` (hrms/procurement/citizen/crm/finance, each via its own `*_PII_KEY` env name funneled into the generic `PII_ENC_KEY` the service code reads), `MFA_ENC_KEY` (identity-service), and `ID_CARD_QR_SECRET` (hrms-service) — each throwing a specific, named error in production rather than silently falling back to a dev value. **Any new service that handles PII, signs tokens, or holds a shared secret must follow this exact shape**: fail closed and loud in production, stable dev default outside it. A secret with a silent production fallback is the thing this convention exists to prevent.

## Known gaps — not covered by this skill

See `.claude/skills/16-production-readiness-audit.md`'s own "Known gaps" section first — several of its listed gaps are release-engineering-shaped and are named again here rather than duplicated in full:

- **Rollback of a bad migration that has already run** — the bootstrap script only covers idempotent forward provisioning (§3 above), not undoing a shipped, defective migration at scale.
- **Zero-downtime / rolling deploys** — the current model is full-fleet `pm2 restart all` with no `wait_ready`/health-gated cutover and no blue-green/canary path (§5 above).
- **DR drill outcomes** — `.github/workflows/dr-drill.yml` exists and runs, but its actual pass/fail history and what it covers vs. what skill 16 flags as an uncovered gap (backup/restore correctness, RTO/RPO) has not been reviewed for this skill; read it before claiming DR posture is understood.
- **External-system integration correctness at release time** (PFMS, payment gateways, e-invoicing) — release gates check internal evidence lanes, not live compatibility with the actual external system's current behavior.
- **Semantic-release automation** — configured (`.releaserc.json`) but dormant; don't assume version bumps or changelog generation happen automatically until a workflow actually invokes it.
