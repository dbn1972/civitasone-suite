# CivitasOne Suite — Production Readiness Report

**Date:** 2026-06-30
**Branch:** `feat/full-remediation-wave-2026-06-27`
**Scope:** 33 Fastify microservices, shared packages, full per-service test sweep
**Method:** Live per-service `vitest run` against the dev stack + structural scan + automated gate scorer (`scripts/production-readiness-score.mjs`).

---

## 1. Executive Summary

The platform is **architecturally complete and fully green on automated tests**. Every one of the 33 services builds, every CQRS write path is queue-first, every queue-consuming service ships a worker, and ops/readiness routes are present platform-wide.

- **Test sweep:** **33/33 services green — 1,550 tests passing, 8 skipped, 0 failing.**
- **Automated readiness gates:** **10/10 green (100/100)** — queue-first writes, response validation, workers, ops routes, no mock web fallback, k6, contract tests, perf indexes.
- **Endpoints:** 1,015 across the suite. **Workers:** 31/31. **Migrations:** 259 (+1 this wave). **sendAccepted:** 494, **sendValidated:** 204.

**Maturity level: Advanced.** **Recommendation: Conditional GO for controlled UAT** on a private network with Keycloak RS256 + SQS. The remaining gates for *unrestricted* production are environmental/operational (live E2E against the real stack, Keycloak RS256 verified in deploy, secrets injected), not code completeness.

This wave also closed three stale-test failures (queue FIFO, policy dedup, crm PII) — all test drift behind intentional platform hardening, not product bugs (see §5).

---

## 2. This Wave — What Changed

| Area | Change | Evidence |
|------|--------|----------|
| **eSign / DSC (estab)** | Added CCA-licensed Aadhaar eSign ESPs (**C-DAC**, **eMudhra**) alongside the mock. Real CCA eSign 3.x request builder carrying the SHA-256 doc hash, ASP request signing (RSA-SHA256), provider selection via `ESIGN_AADHAAR_PROVIDER`. Live credentials force a citizen redirect (`ESIGN_REDIRECT_REQUIRED`); dev/test falls back to a clearly-marked mock CMS. | `services/estab-service/src/modules/esign/providers.ts`; `tests/esign.test.ts` (10 tests) |
| **Full-text file search (estab)** | CSMOP file search over subject/number/dept **and** note-sheet content, tenant-scoped + relevance-ranked (`websearch_to_tsquery`), generated `search_tsv` + GIN indexes. | migration `0017_file_fulltext_search.sql`; `GET /v1/estab/files/search`; `tests/file-search.test.ts` (3 tests) |
| **Test-drift fixes** | queue FIFO publish test aligned to the SNS-style fan-out; policy dedup test uses a valid UUID envelope; crm domain test seeds `CRM_PII_KEY`. | `queue-service/tests/heartbeat-fifo.test.ts`, `policy-service/tests/policy.test.ts`, `crm-service/tests/domain.test.ts` |

---

## 3. Full Test Matrix (live run, 2026-06-30)

| Service | Test files | Tests | Status |
|---------|-----------:|------:|:------:|
| finance | 12 | 126 | ✅ |
| hrms | 13 | 271 (+8 skip) | ✅ |
| payroll | 10 | 184 | ✅ |
| workflow | 8 | 86 | ✅ |
| procurement | 5 | 75 | ✅ |
| estab | 13 | 70 | ✅ |
| identity | 9 | 59 | ✅ |
| citizen | 5 | 56 | ✅ |
| notification | 8 | 54 | ✅ |
| analytics | 6 | 47 | ✅ |
| policy | 4 | 46 | ✅ |
| admin | 2 | 41 | ✅ |
| grant | 4 | 41 | ✅ |
| telephony | 5 | 42 | ✅ |
| audit | 2 | 37 | ✅ |
| project | 3 | 34 | ✅ |
| crm | 5 | 33 | ✅ |
| asset | 2 | 28 | ✅ |
| legal | 2 | 28 | ✅ |
| queue | 6 | 25 | ✅ |
| contract | 4 | 23 | ✅ |
| helpdesk | 3 | 19 | ✅ |
| inventory | 1 | 19 | ✅ |
| billing | 2 | 17 | ✅ |
| location | 1 | 17 | ✅ |
| knowledge | 2 | 14 | ✅ |
| report | 2 | 13 | ✅ |
| gateway | 2 | 11 | ✅ |
| stock | 1 | 11 | ✅ |
| tenant | 2 | 11 | ✅ |
| install | 1 | 4 | ✅ |
| plugin | 1 | 4 | ✅ |
| theme | 1 | 4 | ✅ |
| **Total** | **151** | **1,550 (+8 skip)** | **33/33 ✅** |

---

## 4. Module Inventory & Readiness by Domain

Readiness tiers blend structural completeness (routes/consumers/migrations) with the official module scores and verified test depth.

### Tier A — Production-ready / strong
| Service | Modules | Notes |
|---------|---------|-------|
| **estab** (eOffice/CSMOP) | files, committee, dfa, correspondence, records, esign, operators, handover, approval-rules, linkage, address-book, facilities, legal, assets, notifications, migration, dashboard | CSMOP audit 89/100; eSign (C-DAC/eMudhra) + full-text search added; 70 tests. |
| **asset** | register, lifecycle, depreciation, maintenance, insurance, verification, enterprise, dashboard | Phase 2–3 depth; proc→asset→GL proven. |
| **gateway / queue** | platform infra | Header strip, rate limit, `/ready`, prod queue guard, FIFO fan-out. |

### Tier B — Conditional UAT (functionally complete, needs live E2E)
| Service | Modules | Notes |
|---------|---------|-------|
| **finance** | budget, gl, treasury, payments, gst, tds, pfms, period-close, bank-recon, cashbook, financial-statements, subledger, voucher-print, hoa, masters, fixed-asset, instruments, recurring, reports, audit, integrations, tenant-onboard, dashboard | Largest financial surface; period-close + 3-way match need UAT. 126 tests. |
| **hrms** | 38 modules incl. employee, leave, attendance, payroll-adjacent, pension, gpf, apar, disciplinary, claims, deputation, reservation, service-book, self-service, geo/face attendance, ai-fraud, id-cards | Broadest surface; 271 tests. |
| **payroll** | payroll, loans, statutory, statutory-returns, tax, bank-transfer, form16-pdf, payslip-pdf, integration | 184 tests; payroll→GL proven in memory. |
| **procurement** | indent, vendor, po, grn, tender, rfq, auction, three-way-match, gfr, vendor-blacklist, clearance, approvals, payments, security | 3-way match partial; 75 tests. |
| **workflow** | instances, tasks, definitions, delegations, history, analytics, assignment, dlq, provisioning, admin | Multi-hop; not every module triggers workflows yet. |
| **identity** | users, sessions, mfa, devices, rbac, apikeys, breakglass, sync, tenant-onboard | RS256/JWKS coded; deploy env must set RS256. |
| **citizen / audit / crm / stock / inventory / legal / grant / project / notification** | see scan | Solid wiring; depth/E2E varies. |

### Tier C — Early / scaffold
| Service | Modules | Notes |
|---------|---------|-------|
| knowledge, location, plugin, tenant, theme | 1 module each | Minimal surface, 1–2 tests. Functional but shallow. |
| helpdesk, install, contract, report | 2–3 modules | Core flows present; depth pending. |

---

## 5. Failures Found & Resolved This Wave

All three were **stale tests lagging behind intentional platform hardening**, not product defects:

1. **queue-service — FIFO publish wiring (3 tests).** `publish()` was redesigned to SNS-style fan-out (each subscriber gets its own per-topic queue, discovered via `ListQueues`). The test mock only handled the old single-queue create/get path, so zero queues resolved and no message was sent. **Fix:** mock `ListQueuesCommand` to return a subscriber queue; assert send-side FIFO fields (`MessageGroupId`/`MessageDeduplicationId`).

2. **policy-service — consumer dedupe (1 test).** The bus now validates the envelope (`messageId` must be a UUID) before any handler runs (04-T3). The test used `messageId: "same-msg"`, which routed straight to the DLQ → handler never ran → count 0. **Fix:** use a valid UUID.

3. **crm-service — PII at rest (1 test).** Field-level AES-256-GCM (DPDP/P1-2) fails closed without `CRM_PII_KEY`. The only test creating a contact *with* email/phone never seeded the key, so the consumer threw, retried to DLQ, and the create timed out. **Fix:** seed a deterministic `CRM_PII_KEY` test key (mirrors `pii-crypto.test.ts`).

---

## 6. Remaining Risks / Gates for Unrestricted Production

1. **Live E2E** — web E2E still mock-heavy; must run against the real stack for UAT sign-off.
2. **Keycloak RS256** — coded and tested with HS256 bypass; deploy env must set `JWT_ALGORITHM=RS256` + `KEYCLOAK_URL` and verify JWKS.
3. **Secrets** — `ecosystem.config.js` uses HS256/dev defaults; production must inject real secrets (incl. `CRM_PII_KEY`, `INTERNAL_SERVICE_SECRET`, ESP keys) from a secret manager.
4. **eSign live** — C-DAC/eMudhra redirect+callback path is built and gated; needs a licensed ASP id/key and the response-URL callback wired in the target environment.
5. **Depth gaps** — procurement 3-way match, finance period-close, grant UC→finance reconciliation, and the Tier-C scaffolds need functional deepening + E2E.
6. **Observability** — correlation IDs + heartbeats exist; dashboards/alerts/SLOs not fully deployed.

---

## 7. Sign-off

| Dimension | Status |
|-----------|--------|
| Automated tests (33 services) | ✅ 1,550 passing / 0 failing |
| Automated readiness gates | ✅ 10/10 (100/100) |
| Architecture (CQRS, DB-per-service, outbox, audit, tenant isolation) | ✅ Enforced |
| eSign/DSC (Aadhaar ESP + DSC) | ✅ Pluggable, per-tenant, mock + C-DAC + eMudhra |
| Unrestricted public production | ⏳ Conditional — see §6 |

**CTO recommendation:** Conditional GO for controlled UAT on a private network with Keycloak RS256 and SQS. No unrestricted public production until live E2E is green against the real stack and deploy-env secrets/auth are verified.
