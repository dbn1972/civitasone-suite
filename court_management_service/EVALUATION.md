# Court Management Service — Evaluation

_Reviewer: platform architecture. Scope: the 59-section requirement specification vs. the existing CivitasOne ERP (33 services, HEAD f3d57dc). Branch: `court-management-service` (isolated worktree, no conflict with Kiro)._

## 1. Verdict

The specification is **strong, realistic, and unusually well-scoped**. It correctly refuses the trap of "replace the judiciary" and instead defines a *configurable adjudication layer* for **quasi-judicial and administrative** bodies (revenue courts, collector/SDM/tehsildar courts, consumer commissions, departmental appellate authorities, tribunals) — exactly the space a Government ERP legitimately owns, with **adapter-based** integration where a constitutional/statutory judiciary (e-Courts/NJDG) is authoritative. That framing (§1, §37) is what makes this buildable and defensible.

The single most important architectural instruction in the spec is §47/§59: **"No core court process shall depend on hardcoded workflow logic."** This is a *metadata-driven* requirement — court types, case types, lifecycles, fees, limitation rules, hierarchies, forms, and templates are all configuration, not code. That is the difference between a court *product* and a national court *platform*, and it dictates the whole build.

## 2. What the ERP already gives us (reuse, do not rebuild)

The spec's §4.1 reuse list maps almost 1:1 onto services that already exist. Verified against the tree:

| Spec dependency | Existing ERP capability | State |
|---|---|---|
| Identity & Access, RBAC/ABAC, MFA/SAML/SCIM | `identity-service`, `policy-service` (ABAC engine), `@civitasone/auth` | Real (ABAC enforced) |
| Workflow + Rule Engine + BPMN | `workflow-service` — graph engine **+ new BPMN designer + DMN decision tables** | Real (just landed) |
| Limitation Clock / SLA | `workflow-service` SLA + timers; `legal-service` reminders | Partial — needs a real limitation engine |
| Document / eOffice / File | `estab-service` (eFile, notings hash-chain, DAK, dispatch), `eoffice-sdk` | Real |
| Digital Signature (DSC/eSign) | `packages/render` DSC signer + `estab` eSign providers | Real (providers mock — swap for CCA ESP) |
| Notification | `notification-service` (multi-channel) | Real |
| Payment / Treasury | `finance-service` (fees, treasury, challan, reconciliation) | Real |
| Search | `packages/search` (Meilisearch/OpenSearch) | Real (per-index) |
| Audit | `audit-service` — tamper-evident SHA-256 hash chain | Real (Okta-class) |
| Document rendering (orders/notices PDF) | `packages/render` (PDF/XLSX + DSC) | Real |
| Object storage | `packages/storage` (S3 SigV4) | Real |
| Gov adapters (land records style) | `packages/gov-adapters` (PFMS/GSTN/NACH/TRACES) | Built, **unwired** |
| Legal case master | `legal-service` (cases/hearings/orders/opinions) | Real — the extension base |
| Multi-tenancy | tenant model + RLS + `TenantRouter` (pool/silo/shard) | Real (RLS runtime is the known gap) |

**Genuinely NEW domain the court-service must own** (not in the ERP today): court/authority master + configurable hierarchy, case-type/case-number metadata engine, scrutiny + defect management, **cause-list scheduling** (drag-drop, capacity, conflict, double-booking), **process/notice service tracking**, evidence chain-of-custody, **appeal/revision/review routing** across a configurable hierarchy, compliance/execution as structured actions, certified-copy management, and the **revenue-court** (land-parcel, mutation/partition/demarcation/encroachment workflows + land-records/GIS) and **consumer-court** extensions. Plus VC-integration and the AI-assist layer with §35.5 governance (human-in-the-loop, no autonomous decisions).

## 3. Key risks & how the build must address them

1. **The metadata mandate (§47) is the hardest part and must come first.** If lifecycles/fees/limitation/hierarchy are hardcoded (as most of the ERP is today), the platform fails its own acceptance criterion #19. → The Solution Architect prompt makes a *configuration engine* (court-type / case-type / lifecycle / fee / limitation / hierarchy definitions, versioned + deployable — the same pattern `workflow-service` already uses for definitions/DMN) the foundation, before any domain module.
2. **RLS must be enforced at runtime.** The suite's #1 known defect is that RLS policies exist but the `app.tenant_id` GUC is set on almost no path. The court-service handles adjudication records — cross-tenant leakage is unacceptable. → Every prompt mandates `ENABLE + FORCE ROW LEVEL SECURITY` **and** the tenant-scoped-transaction GUC wiring, with a live-role isolation test (the new services already do this; the foundation in `services/court-service` fixes the `FORCE` gap the meeting-service has).
3. **Human authority over decisions (§35.5, §57.17).** AI drafts, summarizes, schedules — it never issues a final order. → The AI-governance rules are embedded as hard acceptance criteria, not aspirations: human approval, source citation, prompt/output logging, no direct order issuance.
4. **e-Courts/NJDG is integrate-not-replace (§37).** → Built as an env-gated, fail-closed adapter with reconciliation + sync-status, exactly like `gov-adapters` — never a fake success.
5. **Evidence integrity & audit are legal, not cosmetic.** → File-hash + chain-of-custody + legal-hold on evidence; every §41 action into the immutable `audit-service` chain; certified copies DSC-signed with QR verification.
6. **Scale (§52.3): thousands of courts, millions of cases.** → The connection/pgbouncer, partitioning of hot append-only tables (hearings, cause_list_items, audit, notices), and per-pod-state gaps flagged suite-wide must not be repeated here.

## 4. Foundation already staged (this branch)

A `services/court-service` foundation is included: the full service chassis (CQRS, outbox, worker, tenant-scoped-transaction GUC), the core court schema + migration **with `ENABLE`+`FORCE` RLS and the NULLIF-safe policy** (fixing both RLS gaps the meeting-service has), a courtroom double-booking `btree_gist` exclusion, and one complete working vertical slice (`case-registry`: register → list → get, with PII-encrypted parties). It is the template the engineering prompts extend module by module.

## 5. Realistic phasing (the master prompt encodes this)

- **Phase 0 — Foundations:** configuration/metadata engine, court + case-type masters, RLS/tenancy, integration contracts. _Nothing domain-specific is hardcoded._
- **Phase 1 — Core lifecycle:** filing → scrutiny/defect → registration → allocation → party/advocate → cause-list → hearing/adjournment → order (DSC) → closure. The end-to-end chain of §2.
- **Phase 2 — Justice depth:** notice/process service, evidence + chain-of-custody, appeal/revision/review routing, limitation/SLA engine, compliance/execution, certified copies, court fees.
- **Phase 3 — Domain extensions:** revenue-court (land-records/GIS, mutation/partition/demarcation/encroachment) and consumer-court (complaint/mediation/compensation/execution).
- **Phase 4 — Experience & intelligence:** citizen/advocate portal, VC integration, dashboards/reports, multilingual + accessibility, AI-assist with §35.5 governance, e-Courts/NJDG adapter.
- **Phase 5 — Hardening:** invariant tests (money/tenant/concurrency/state-machine), performance/DR, migration, UAT, go-live.

This is a multi-quarter national-scale program; the prompt suite is the map that lets the expert team build it phase by phase against the real ERP — not a single sprint.
