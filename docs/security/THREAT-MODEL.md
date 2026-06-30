# CivitasOne Suite — Threat Model & Abuse-Case Catalog

**Date:** 2026-06-30
**Owner:** Security Lead (platform), with per-domain service owners
**Charter basis:** Platform Charter §35 (Threat Model & Abuse-Case Standard)
**Compliance context:** India DPDP Act, CERT-In directions, GoI CSMOP/eOffice
**Review cadence:** before each major release, when adding an extension surface / infra adapter / deployment mode, and after any Sev-1/Sev-2 incident (§35.5).

> This is a **living document**. Each threat maps to: affected assets, attacker profile, likelihood, impact, mitigations (with code evidence), detection, test approach, and owner (§35.4).

---

## 1. System context & trust boundaries

CivitasOne is a multi-tenant GoI/PSU ERP: 33 Fastify services, DB-per-service Postgres, Redis cache, SQS messaging, Keycloak OIDC, Next.js web, all behind a single gateway.

**Trust boundaries (Charter §34.4):**
1. **Public ingress** → `gateway-service` (only public surface; services bind `127.0.0.1`).
2. **Gateway → internal services** — `x-internal` / `x-service-secret` validated; client headers stripped at the edge.
3. **Service → its own DB** — per-service login role; no cross-DB access.
4. **Service → SQS** — tenant- and service-scoped envelopes; idempotent consumers.
5. **Tenant isolation boundary** — `tenantId` on every entity, cache key, and message.
6. **Admin / break-glass boundary** — elevated access is time-bounded + audited.
7. **Third-party integration boundary** — PFMS, Keycloak, eSign ESP (C-DAC/eMudhra), S3/MinIO.

**Crown-jewel assets:** citizen/employee PII (DPDP), financial ledgers & sanctions (money = bigint paise), eOffice files & notings (CSMOP, hash-chained), audit trail (immutable), auth secrets/JWKS, tenant isolation invariants.

---

## 2. Threat catalog (STRIDE × Charter §35.2 domains)

Likelihood/Impact: L/M/H. "Status" = current mitigation maturity.

| ID | Threat (domain) | Attacker | L | I | Mitigations (evidence) | Detection | Test | Status | Owner |
|----|-----------------|----------|---|---|------------------------|-----------|------|--------|-------|
| **T1** | Cross-tenant data leakage (§35.2) | Authed tenant user | M | H | `tenantId` on every entity + query filter; tenant-scoped cache keys `{svc}:{tenant}:{res}:{id}`; DB-per-service; (deferred) RLS. | Audit `access_denied`; isolation tests | `crm/estab` isolation tests; per-service scope tests | ✅ Strong | Platform Arch |
| **T2** | Privilege escalation to tenant/platform admin | Low-priv user | M | H | Backend `requireRole`/ABAC (`policy-service`); no frontend-only enforcement; gateway header strip. | Audit role-change events | `policy` requireRole tests (BUG-2 regression) | ✅ Strong | Security |
| **T3** | Broken authorization (object-level) | Authed user | M | H | Per-route `requireRole` + tenant scope; classification clearance gate (estab). | Audit denials | route auth inject tests | 🟨 Expand object-level tests | Security |
| **T4** | `x-internal` header forgery / service-secret spoof | External | L | H | Gateway strips inbound `x-internal`; `INTERNAL_SERVICE_SECRET` + constant-time compare (R12). | Gateway logs; 401 rate | `x-internal-bypass`, gateway `security.test.ts` | ✅ Strong | Security |
| **T5** | Compromised / replayed session | External | M | H | Keycloak RS256/JWKS; short-lived tokens; revocable sessions; MFA-capable. | Auth anomaly logs | auth/session tests | 🟨 Verify RS256 in deploy env | Security |
| **T6** | API abuse / DoS / noisy neighbor | Any | M | M | Gateway rate-limit; queue concurrency; per-tenant quotas. | Rate-limit metrics; queue lag | k6 baseline | 🟨 Add per-tenant rate SLO | SRE |
| **T7** | Queue / message poisoning | Authed or insider | L | H | Envelope validation (UUID/tenant) → DLQ before handler (04-T3); idempotency (`markProcessed`); `NonRetryableError` routing. | DLQ count; consumer error count | queue dedupe/poison tests | ✅ Strong | Platform Arch |
| **T8** | Event replay → duplicate destructive action | Insider / MITM | L | H | Idempotent consumers; transactional outbox; orphaned-callback fail-closed (R21). | Audit dup detection | outbox/idempotency tests | ✅ Strong | Platform Arch |
| **T9** | Insecure installation / bootstrap | Operator | M | M | Dev-login gate in prod; prod queue-driver guard; secrets via env/secret-mgr. | Bootstrap validation | queue-production test | 🟨 No guided first-run wizard (Charter G2) | SRE |
| **T10** | Data exfiltration via export/report | Authed admin | M | H | Export gated by role; audit on export; tenant-scoped reads only. | Audit export events | export isolation tests | 🟨 Add export volume alerts | Audit |
| **T11** | Destructive admin misuse | Tenant/platform admin | L | H | Maker-checker on sanctions/inquiry (R11/R19); immutable notings trigger; confirm/audit on destructive ops. | Audit; maker≠checker | maker-checker tests | ✅ Strong | Domain owners |
| **T12** | Log / audit tampering | Insider | L | H | Append-only audit via outbox; eOffice hash-chain (R9/R10). | Hash-chain verify | hash-chain tests | ✅ Strong | Audit |
| **T13** | Supply-chain compromise | External | M | H | pnpm lockfile; SAST workflow; pinned deps (policy). | CI security workflow | SAST scan | 🟨 Add dep-pin + provenance gate | Security |
| **T14** | Insider threat (support/eng) | Internal staff | L | H | Break-glass (time-bound, audited); role separation; least privilege. | Break-glass audit | break-glass tests | ✅ Strong | Security |
| **T15** | PII at rest exposure (DPDP) | DB/backup access | M | H | Field-level AES-256-GCM + blind index (crm/hrms); fail-closed without key. | Key-access audit | pii-crypto tests | ✅ Strong | Security |
| **T16** | Plugin/theme abuse | Partner/tenant | L | H | Plugin/theme are internal scaffolds today; **no third-party execution path enabled** (Charter G4). | n/a | n/a | ⬜ N/A until extension model ships | Platform Arch |
| **T17** | Classification bypass (eOffice secret files) | Authed user | M | H | Operator `clearance_level` + `isAccessAllowed`; denial audited; top-secret read break-glass logged. | Audit `access_denied_clearance` | clearance tests | ✅ Strong | estab owner |
| **T18** | Financial integrity (float drift / unbalanced) | Authed user | L | H | Money as bigint paise + `@civitasone/schemas/money`; double-entry zero-sum; 3-way match. | GL balance checks | finance tests (126) | ✅ Strong | finance owner |

---

## 3. Abuse-case catalog (Charter §35.3)

| AC | Scenario | Expected control behaviour | Verified by |
|----|----------|----------------------------|-------------|
| **AC1** | Tenant A attempts to read Tenant B's records | Query/cache tenant filter returns nothing; denial audited | isolation tests (crm/estab) |
| **AC2** | Low-privilege user calls an admin route directly | 403 `FORBIDDEN` at backend `requireRole` (not UI-only) | policy requireRole tests |
| **AC3** | Replayed SQS message for a destructive command | `markProcessed` dedupes; no second effect | idempotency tests |
| **AC4** | Support user bypasses approval to view a tenant | Break-glass required, time-bound, audited | break-glass tests |
| **AC5** | Operator misconfigures security defaults at install | Prod guards refuse dev-login + memory queue | queue-production test |
| **AC6** | User opens a `secret`-classified eOffice file without clearance | 403 + `access_denied_clearance` audit | clearance tests |
| **AC7** | Dispatch a DFA without the mandatory eSign | Blocked; status stays pre-dispatch | esign mandatory-gate test |
| **AC8** | Integration exports excessive data without audit | Export role-gated + audited; (todo) volume alert | export tests / T10 |
| **AC9** | Forged `x-internal` to call a service directly | Gateway strips header; service rejects (401) | x-internal-bypass test |
| **AC10** | Malformed envelope (non-UUID id) to a consumer | Routed to DLQ before any handler runs | queue dedupe test |

---

## 4. Open actions (tracked)

1. **T3** — add systematic object-level (IDOR) tests across high-value services (finance, hrms, estab).
2. **T5/T9** — verify Keycloak RS256 + secrets in the target deploy env; document first-run hardening.
3. **T6/T10** — add per-tenant rate-limit SLO + export-volume anomaly alerts.
4. **T13** — enforce dependency pinning + provenance check in CI.
5. Re-run this model before the next major release and after any Sev-1/2 incident.
