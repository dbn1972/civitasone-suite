# CivitasOne Suite — Platform Charter Conformance & Deviations

**Date:** 2026-06-30
**Reviewed against:** Multi-Tenant Product Platform Charter v2.0 (Vol 1) + Full Product Spec (Vol 2)
**Method:** Direct code verification of the charter's specific mandates against the repo (not memory-based).
**Branch:** `feat/full-remediation-wave-2026-06-27`

---

## 0. How to read this document

CivitasOne is a **domain-specific Government-of-India / PSU ERP** (DPDP, CERT-In, GST/TDS, PFMS, HoA). The Charter describes a **generic, globally-deployable commercial SaaS platform** with a public marketing brand and a plugin marketplace. Most divergences below are therefore questions of **applicability** to a GoI ERP, not careless non-compliance.

Verdict legend:
- ✅ **Meets / Exceeds** — implemented and verified.
- 🟦 **Deviation (governed)** — intent satisfied by a different (often stronger) mechanism; should be formally recorded per Charter §34.5.
- 🟨 **Partial** — present but below the mandated depth.
- 🟥 **Gap** — mandated but not implemented.
- ⬜ **N/A (proposed)** — charter surface not applicable to a GoI ERP; recommend formal scope-out.

---

## 1. §46 Final Non-Negotiables — Line-by-Line Matrix

| # | Charter non-negotiable (§46) | Verdict | Evidence / Note | Owner |
|---|------------------------------|:------:|-----------------|-------|
| 1 | Tenant isolation | ✅ Exceeds | DB-per-service **+** per-module PG schema; `tenantId` on every entity; tenant-scoped cache keys; isolation tests. | Platform Arch |
| 2 | Secure authentication | ✅ Meets | Keycloak OIDC + RS256/JWKS (`@civitasone/auth`); HS256 test-only. | Security |
| 3 | Explicit authorization | ✅ Meets | RBAC + ABAC + `policy-service` (`abac`, `evaluate`); backend `requireRole`. | Security |
| 4 | Least privilege | ✅ Meets | Scoped roles; service secrets; gateway header strip. | Security |
| 5 | Auditability | ✅ Meets | `audit-service`; every mutation emits audit event via outbox. | Audit |
| 6 | Accessibility (WCAG 2.1 AA) | 🟨 Partial | `ui-kit` (shadcn) + accessibility skill; no automated AA gate / audit evidence found. | Web/UX |
| 7 | Localization readiness | 🟨 Partial | i18n skill + tenant-locale rendering; full no-hardcoded-string audit not evidenced. | Web/UX |
| 8 | Design-system consistency | ✅ Meets | `packages/ui-kit` shared component library. | Web/UX |
| 9 | API consistency | ✅ Meets | 1,015 endpoints; consistent `sendAccepted`/`sendValidated`; zod boundaries. | Platform Arch |
| 10 | API governance & compatibility review | 🟨 Partial | Contract tests + gateway contract; no formal versioning/deprecation policy doc. | Platform Arch |
| 11 | Data-modeling standards | ✅ Exceeds | id/tenant/created/updated/createdBy/updatedBy/version on every entity; money as bigint paise; UTC `timestamptz`. | Platform Arch |
| 12 | Entitlement clarity | 🟨 Partial | Editions (Small Office/PSU/Govt) + `billing-service`; plan/entitlement/config/authz separation not fully evidenced. | Product |
| 13 | Installation as first-class surface | 🟥 Gap | `install-service` is tenant onboarding/provisioning, **not** the §17 infra first-run wizard. | SRE/Platform |
| 14 | First-run setup: CDN / MySQL-or-PostgreSQL / S3 / Redis / queue | 🟥 Gap | Infra configured via docker-compose/env/Terraform/Helm; no guided, connectivity-tested setup flow. | SRE/Platform |
| 15 | Queue adapter choice: SQS / Kafka / RabbitMQ | 🟥 Gap | **SQS real** (+ memory for tests). `kafka.ts` throws "not implemented"; `rabbitmq.ts` is a dev-only memory shim (throws in prod). Abstraction layer ✅. | Platform Arch |
| 16 | Service-oriented architecture | ✅ Meets | 33 bounded services. | Platform Arch |
| 17 | Service-owned tables | ✅ Meets | Each service owns DB + migrations. | Platform Arch |
| 18 | Service-prefixed table names | 🟦 Deviation | Uses **DB-per-service + PG schema-per-module** (`files.estab_notings`, `crm.contacts`) instead of `service_table`. Exceeds isolation intent. | Platform Arch |
| 19 | No cross-service SQL joins | ✅ Meets | Reads = HTTP; writes = SQS; arch-guard CI. | Platform Arch |
| 20 | No shared mutable table ownership | ✅ Meets | DB-per-service. | Platform Arch |
| 21 | Governed themes | 🟨 Partial | `theme-service` = scaffold (1 module `tokens`); no preview/rollback/protected-zone enforcement. | Web/UX |
| 22 | Official plugin architecture | 🟨 Partial | `plugin-service` = scaffold (1 module `items`); no manifest/permission/lifecycle model. | Platform Arch |
| 23 | Plugin isolation & auditability | 🟥 Gap | No sandbox/isolation runtime, signature verification, or plugin audit registration. | Security/Platform |
| 24 | Developer portal as first-class surface | 🟨 Partial | Web `developer-portal` page exists; **no developer-portal service**, no API-reference/SDK/error-code catalog depth. | Developer Experience |
| 25 | Public legal completeness | 🟨 Partial | `legal` page exists but inside authenticated `(app)` group; not a public trust/legal site with footer discoverability. | Legal/Web |
| 26 | Trust page discoverability | 🟨 Partial | `docs/SECURITY.md` etc. exist; no public trust center. | Legal/Web |
| 27 | Threat model & abuse-case maintenance | 🟥 Gap | SAST docs + security review exist; no maintained §35 threat-model / abuse-case catalog. | Security |
| 28 | Tenant-isolation verification | ✅ Meets | Isolation tests across API/persistence/cache layers (crm/estab/etc.). | QA |
| 29 | SLOs, SLIs, alerts, runbooks for critical services | 🟥 Gap | Some runbooks (`OPERATIONS_DASHBOARD_RUNBOOK.md`, `RLS-ENGAGEMENT-RUNBOOK.md`); **no per-service SLO/SLI/error-budget** definitions. | SRE |
| 30 | Break-glass & support-access governance | ✅ Meets | identity `breakglass` module + policy break-glass flow, audited. | Security |
| 31 | Compliance control mapping | 🟨 Partial | DPDP/CERT-In awareness in code; no §42 control-to-evidence matrix doc. | Compliance |
| 32 | Upgrade & migration policy | 🟨 Partial | 259 ordered SQL migrations; no published upgrade/compatibility-window policy. | Platform Arch |
| 33 | Capacity & scale guardrails | 🟨 Partial | k6 baseline + perf indexes; no documented capacity/cost-review triggers. | SRE |
| 34 | Documented ownership | 🟨 Partial | `CODEOWNERS` + steering; no per-domain owner table per §29.1. | Eng Mgmt |
| 35 | Safe defaults | ✅ Meets | Fail-closed workflow/auth, prod queue guard, dev-login gate, PII fails closed. | Security |

**Tally:** ✅ 14 · 🟦 1 · 🟨 13 · 🟥 6 · ⬜ 0 (of 35).

---

## 2. Genuine Gaps (🟥) — detail & decision needed

### G1. Queue adapter choice (§21.2, §46-15)
Only SQS is production-real. **Decision:** implement Kafka + RabbitMQ adapters, **or** formally narrow the platform standard to "SQS-only (AWS/LocalStack)" for the GoI deployment model and record it as a governed deviation. The stable `@civitasone/queue` abstraction means a future adapter is additive.

### G2 / G3. First-run infra wizard + installation surface (§16, §17)
Infra is provisioned by ops tooling, not a guided wizard. **Decision:** if self-hosted/source-install for departments is a goal, build the §17 setup flow (CDN/DB/S3/Redis/queue with connectivity validation). If delivery is managed/gov-cloud only, scope §16–17 wizard out formally.

### G4. Plugin isolation & auditability (§24, §40)
No sandbox/manifest/signature/lifecycle. **Decision:** deprioritize until a third-party extension model is actually required; until then, mark plugin/theme services as "internal-config scaffolds, not an open extension platform."

### G5. Threat model & abuse-case catalog (§35)
**Action (recommended now):** stand up `docs/security/THREAT-MODEL.md` + abuse-case catalog (cross-tenant leakage, privilege escalation, replayed destructive message, classification bypass, etc.). CERT-In posture expects this.

### G6. Per-service SLO/SLI + runbooks (§38)
**Action (recommended now):** define SLIs (availability, p95 latency, error rate, queue lag) + SLOs + error-budget owner + runbook per critical service (finance, identity, gateway, queue, workflow, estab).

---

## 3. Governed Deviations (🟦) — record & accept

| Deviation | Charter rule | CivitasOne approach | Why acceptable |
|-----------|--------------|---------------------|----------------|
| Table naming | §19.2 `service_table` | DB-per-service + PG schema-per-module | Stronger isolation than prefixes; achieves the rule's intent. |
| Single DB engine | §17.4/§46 "MySQL or PostgreSQL" | PostgreSQL-only (RLS, tsvector, schemas) | GoI ERP standardizes on PG; dual-engine adds cost with no buyer value. |

---

## 4. Proposed N/A scope-outs (⬜) — confirm with product/legal

For a GoI/PSU ERP (on-prem / gov-cloud, not a public commercial SaaS), recommend formally scoping these charter surfaces as **out of scope** unless a future edition needs them:
- Public marketing brand site (§13) and marketplace/publisher governance (§45).
- Multi-region data residency (§15.4) beyond India.
- Self-hosted *source* distribution (§16.1) if delivery is managed/gov-cloud.
- MySQL adapter (§17.4); Kafka/RabbitMQ adapters (§21.2) — pending G1 decision.

> Note: DPDP legal-page discoverability for the **citizen-facing** portal (citizen-service) is **NOT** scoped out — it likely remains a legal requirement and is tracked under §46-25/26 (🟨).

---

## 5. Recommended action plan (priority order)

1. **Author this conformance doc into governance** (done — this file) and review with arch/security/product owners.
2. **G5 Threat model + G6 SLO/runbook set** — highest-value, closes the two largest soft gaps; aligns with CERT-In.
3. **G1 queue-adapter decision** — implement or formally scope to SQS-only.
4. **§46-25/26 citizen-facing legal/privacy discoverability** (DPDP).
5. **Decide §16–17 installation scope** (managed-only vs self-hosted wizard).
6. **Fill 🟨 governance docs**: API versioning/deprecation policy, upgrade/compatibility policy, compliance control matrix, per-domain owner table, accessibility/localization audit evidence.

---

## Appendix — Verification commands used

```
# queue adapters (stub check)
read services/queue-service/src/adapters/{kafka,rabbitmq,sqs,memory}.ts
# install-service scope
list services/install-service/src/modules/{stages,provisioning,orchestrator}
# web public surfaces
ls apps/web/src/app  (legal + developer-portal live under (app) authenticated group)
# no developer-portal service
ls services/*developer* services/*portal*  -> none
```
