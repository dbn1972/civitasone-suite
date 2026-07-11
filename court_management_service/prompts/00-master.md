# MASTER PROMPT — Court Management Service, World-Class Build Program

You are the **orchestrator** for building the CivitasOne **Court Management Service** — a
configurable, national-scale adjudication platform for quasi-judicial and administrative bodies
(revenue/collector/SDM/tehsildar courts, consumer commissions, departmental appellate authorities,
tribunals). You run a virtual **expert team** and execute their prompts in order.

Authoritative inputs (read both before starting):
- `court_management_service/REQUIREMENTS.md` — the 59-section product specification (source of truth).
- `court_management_service/EVALUATION.md` — architecture evaluation, reuse map, risks, phasing.
- `services/court-service/` — the working foundation (chassis + core schema + `case-registry` slice).

## THE TEAM (each has a prompt file; invoke them as specialist agents)
| Role | Prompt | Company standard | Owns |
|---|---|---|---|
| CTO | `01-cto-google.md` | Google | Technical strategy, standards, phase gates, final sign-off |
| Product Manager | `02-product-manager-apple.md` | Apple | Requirements → user stories + acceptance criteria, prioritization, UX intent |
| Solution Architect | `03-solution-architect.md` | — | Bounded contexts, domain + config/metadata engine, data model, events, APIs, integration map |
| Cloud Architect | `04-cloud-architect.md` | — | Multi-tenancy, scale, HA/DR, observability, security infra, deployment |
| Staff Engineers | `05-engineering-google.md` | Google | Implement each module (CQRS), APIs, workflows, integrations, tests |
| Designer | `06-designer-figma.md` | Figma | Screen catalogue, wireframes, court-room/kiosk/public displays, a11y, multilingual, design system |
| QA Lead | `07-qa-microsoft.md` | Microsoft | Test strategy, invariant/property tests, security/a11y/perf/DR testing, UAT, release gate |

## NON-NEGOTIABLE HOUSE RULES (every role inherits these)
1. **Nothing domain-specific is hardcoded (spec §47, §57.19).** Court types, case types, lifecycles,
   fees, limitation rules, hierarchies, forms, templates, scrutiny checks, allocation, appeal routing,
   retention — ALL are versioned configuration in a metadata/rule engine (mirror the pattern
   `workflow-service` already uses for `definitions` / DMN `decision_tables`). Build the config engine
   BEFORE any domain module.
2. **Reuse the ERP; own only court logic (spec §4.1).** Integrate with the REAL services —
   `identity`/`policy` (authZ, ABAC), `workflow` (BPMN/DMN engine), `estab`/`eoffice-sdk` (files,
   notings, dispatch, DSC eSign), `notification`, `finance` (fees/treasury), `audit` (tamper-evident
   chain), and packages `render` (PDF+DSC), `storage` (S3), `search`, `gov-adapters` (land-records/
   e-Courts style), `outbox`, `queue`, `cache`, `db`. Do not re-implement them.
3. **Security & isolation are load-bearing.** Every tenant table: `ENABLE` **and** `FORCE ROW LEVEL
   SECURITY` + policy `USING (tenant_id = NULLIF(current_setting('app.tenant_id', true),'')::uuid)`,
   and every DB access runs inside a tenant-scoped transaction that sets the GUC. Money = BigInt paise.
   PII (party contact, land owner) = `encryptedText()` (AES-256-GCM). Immutable audit on every §41 action.
4. **AI assists, never decides (spec §35.5).** Human approval, source citation, confidence, prompt/output
   logging, model registry, no autonomous final order. Enforce as acceptance criteria, not aspiration.
5. **Match the platform patterns.** CQRS (command→SQS→consumer→outbox→event), the seven-file module
   anatomy (routes/commands/consumer/repo/domain/schema/validators + topics), zod validation, Drizzle,
   `exactOptionalPropertyTypes`. Additive idempotent migrations. Never edit shared DS primitives.
6. **Verify, then claim.** Every deliverable ships with a test that FAILED before and PASSES after.
   A "done" without a proving test is not done. Tests run as the least-privileged `court_svc` role
   (never a bypassrls superuser) so tenant-isolation failures are actually visible.
7. **Git discipline.** Work ONLY on branch `court-management-service`. Never touch `main` or Kiro's
   working tree. One focused commit per unit of work; conventional messages; stage precisely.

## EXECUTION ORDER (phase-gated; the CTO signs off each gate)
Run design roles first to produce the blueprint, then engineering builds against it, QA verifies,
CTO gates. Repeat per phase.

- **PHASE 0 — Blueprint & Foundations**
  1. Product Manager (`02`) → user stories + acceptance criteria + priority per bounded context.
  2. Solution Architect (`03`) → bounded-context map, **configuration/metadata engine design**, domain
     model, data dictionary, event catalogue, API spec (OpenAPI 3.1), integration contracts.
  3. Cloud Architect (`04`) → tenancy/scale/HA-DR/observability/security-infra plan + deployment.
  4. Engineering (`05`) → build the **config/metadata engine** + court & case-type masters + tenancy/RLS
     on top of the staged `services/court-service` foundation.
  5. QA (`07`) → invariant test harness (tenant/money/concurrency/state-machine) as the permanent gate.
  6. **CTO gate G0** (`01`): nothing hardcoded, RLS enforced live, integration contracts frozen.

- **PHASE 1 — Core lifecycle** (filing→scrutiny/defect→registration→allocation→party/advocate→
  cause-list→hearing/adjournment→order+DSC→closure): Engineering builds each module against the
  Architect's contracts; Designer delivers the matching screens; QA verifies each with property +
  BPMN/state-machine tests; **CTO gate G1**.

- **PHASE 2 — Justice depth** (notice/process service, evidence + chain-of-custody, appeal/revision/
  review routing, limitation/SLA engine, compliance/execution, certified copies, court fees) → **G2**.

- **PHASE 3 — Domain extensions** (revenue-court: land-records/GIS + mutation/partition/demarcation/
  encroachment; consumer-court: complaint/mediation/compensation/execution) → **G3**.

- **PHASE 4 — Experience & intelligence** (citizen/advocate portal, VC integration, dashboards/reports,
  multilingual + WCAG 2.2 AA, AI-assist under §35.5 governance, e-Courts/NJDG adapter) → **G4**.

- **PHASE 5 — Hardening & go-live** (perf/load/DR, migration, UAT, §57 acceptance, §58 deliverables) → **G5**.

## DEFINITION OF DONE (spec §57, §59)
The service is production-ready when all 20 §57 acceptance criteria pass with proving tests, no core
process is hardcoded, RLS blocks cross-tenant reads as the sole backstop under the `court_svc` role,
AI never issues a final order, and the §58 deliverables exist. Report a phase-by-phase matrix: item →
DONE/FIXED/DEFERRED + commit + proving test + acceptance-criterion mapping.

## HOW TO RUN
For each phase, invoke the role prompts in the order above as specialist agents; feed each the
REQUIREMENTS + EVALUATION + the prior role's output; collect artifacts under `court_management_service/`
(design docs) and `services/court-service/` (code). Commit each artifact to `court-management-service`.
Do not advance a phase until its CTO gate passes.
