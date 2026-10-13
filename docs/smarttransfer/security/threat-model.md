# SmartTransfer OS — Threat Model (STRIDE)

> Spec §14 (Security), §19 deliverable 15 (Security & privacy architecture). Decisions: D-ST-04
> (APPROVED — one tenant per cycle-owning authority; districts are jurisdiction scopes), D-ST-10
> (APPROVED — SmartTransfer never writes HRMS/Workforce Core tables; it acts only through the
> `applyPosting` command), D-ST-11 (PROPOSED — org/jurisdiction claims resolver), D-ST-19
> (APPROVED — every `smarttransfer.*` / `hrms.posting.*` topic ships a `defineContract`).
> Companion: [`privacy-impact-assessment.md`](privacy-impact-assessment.md). Platform baseline:
> [`docs/SECURITY.md`](../../SECURITY.md), [`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md).
>
> **Status.** M01 artefact. It covers the data flows that exist or are being built in M01 (Workforce
> Core schema #1984, `applyPosting` #1988, smarttransfer-service skeleton #1979, eOffice loop-back
> #1985). Flows that depend on PROPOSED decisions (solver #1978/D-ST-05, policy #1981/D-ST-07,
> signing D-ST-12, payroll D-ST-13) are modelled at the interface only and labelled **PENDING** so
> the control is designed before the feature lands. This is a living document (SECURITY.md §5).
>
> **Author:** ST-M01-15 (SEC workstream). **Independent review:** PENDING (the builder never
> certifies its own security work — spec §P09).

## 1. Scope and trust boundaries

SmartTransfer moves government employees between sanctioned posts. The data is personal (DPDP Act
2023 personal data) and the decisions are statutory, so the two assets that matter most are
**tenant/jurisdiction isolation of personal data** and the **integrity of the posting write path**
(a wrong or forged posting changes a person's station, office and — downstream — their pay).

### 1.1 Data-flow diagram (M01 surface)

```
                         (TB1) gateway auth + module gate                 (TB2) service RLS
  ┌─────────────┐   HTTPS   ┌───────────┐   internal    ┌───────────────────────┐
  │ Employee    │──────────▶│  gateway  │──────────────▶│ smarttransfer-service │  movement DB
  │ portal (§9) │  Bearer   │  (8080)   │  x-internal+  │  (cycles, requests,   │  (FORCE RLS,
  └─────────────┘           │  authPlugin│  secret       │   runs, orders…)      │   per-tenant)
  ┌─────────────┐           │  moduleGate│              └───────────┬───────────┘
  │ Command     │──────────▶│           │                          │  (TB4) producer ACL
  │ centre (§10)│           └───────────┘                          │  hrms.posting.apply
  └─────────────┘                                                   ▼  (command only, D-ST-10)
                                                        ┌───────────────────────┐
                 (TB3) eOffice callback (signed ref)    │ hrms-service /         │  Workforce Core
          ┌──────────────┐   module decision callback   │  Workforce Core        │  schema (FORCE
          │ estab-service│─────────────────────────────▶│  applyPosting consumer │  RLS, per-tenant)
          │  (eOffice)   │   hr_transfer_order / cycle   │  → post_occupancy,     │
          └──────────────┘                               │    posting_ledger,     │
                                                         │    employee, audit     │
                 (TB5) sidecars (PENDING)                └───────────┬───────────┘
          ┌──────────────┐   SolverPort / PolicyPort                 │ hrms.posting.* events
          │ solver /      │◀── frozen snapshot in, plan out          ▼
          │ policy sidecar│   (no PII, no DB — D-ST-05/07 PENDING)   payroll-service (D-ST-13 PENDING)
          └──────────────┘
                                                         evidence store: decision_evidence rows +
                                                         audit_events (hash-chained, audit-service)
```

### 1.2 Trust boundaries

| ID | Boundary | Control that enforces it | Evidence / status |
|----|----------|--------------------------|-------------------|
| TB1 | Internet → gateway | Keycloak JWT (RS256, `tid` claim) verified in `authPlugin`; module gate fails closed per tenant (ST-M01-02/#1986, D-ST-24); session denylist (SEC-006) | `packages/auth/src/plugin.ts`; gating tests #1986/#1989 |
| TB2 | Service → its own DB | DB-per-service; FORCE RLS + `app.tenant_id` GUC per tx; NOBYPASSRLS runtime role | `workforce-core-rls-security.test.ts` (this PR); smarttransfer RLS tests (ST-M01-15b) |
| TB3 | eOffice → hrms (loop-back) | Signed e-file decision callback on an allow-listed ref type; opt-in env, no D-101 allow-list against PROPOSED D-ST-08 | ST-M01-16 (#1985) |
| TB4 | smarttransfer-service → hrms posting write | **Command only** (`hrms.posting.apply`); consumer-side **producer ACL** derived from the frozen contract `owner`; never a direct table write (D-ST-10) | `producer.ts` + tests (this PR) |
| TB5 | engine ↔ solver/policy sidecars | Frozen snapshot in / plan out; **no PII, no DB credential** to the sidecar; AI never in the decision path (P07/D-ST-17) | PENDING — D-ST-05/07 spikes (#1978/#1981) |

## 2. STRIDE analysis per flow

Severity uses the SECURITY.md §8.4 bands. "Status" is **Mitigated** (control exists and is tested),
**Partial** (control exists, residual noted), or **PENDING** (feature/decision not yet landed).

### 2.1 Portal / command centre → gateway → smarttransfer-service

| STRIDE | Threat | Mitigation | Sev | Status |
|--------|--------|-----------|-----|--------|
| **S**poofing | A caller forges another employee/officer identity to submit a request or read a list | JWT verified at the gateway; tenant/jurisdiction derived from the **server context**, never a client id (house rule 9, P08); no `tid` from the body | High | Mitigated |
| **T**ampering | A client mutates `tenantId`/`jurisdiction_unit_id` in a request body to reach another scope | zod at the boundary; the consumer stamps tenant from the envelope; RLS WITH CHECK rejects a cross-tenant write | High | Mitigated (ST-M01-15b asserts jurisdiction scoping on list routes) |
| **R**epudiation | An officer denies having submitted/approved a movement | Every write path emits `audit.event.record` in the same tx (house rule 1); audit is hash-chained (audit-service) | Med | Mitigated |
| **I**nfo disclosure | Tenant A reads tenant B's cycles/requests/orders; a list leaks across jurisdictions | FORCE RLS on every smarttransfer table; lists scoped to the caller's jurisdiction (house rule 9) | **Critical** | Mitigated (ST-M01-15b RLS + jurisdiction tests) |
| **D**oS | A flood of cycle/run requests exhausts a worker | Async jobs + resource-limited workers; gateway/policy rate limits (SECURITY.md §8.6); cancellation/checkpoint (spec §15) | Med | Partial (per-route rate limits are platform-owned; load test at M09) |
| **E**levation | A `citizen` role reaches a staff-only route | `requireRole` on every route excludes `citizen` (house rule 9); in-service entitlement re-check (#1979) | High | Mitigated |

### 2.2 smarttransfer-service → hrms `applyPosting` → payroll

| STRIDE | Threat | Mitigation | Sev | Status |
|--------|--------|-----------|-----|--------|
| **S**poofing | A service other than SmartTransfer (payroll, a rogue leave consumer, a mis-wired future producer) enqueues `hrms.posting.apply` to force a posting | **Producer ACL** (this PR): the consumer refuses any producer not on the allow-list derived from the frozen contract `owner` (`smarttransfer-service`) + the hrms in-service affordance; refusal is audited, nothing is written, no raw error leaks (D-ST-10/19) | **Critical** | Mitigated (`producer.ts` + consumer refusal tests) |
| **T**ampering | SmartTransfer writes a Workforce Core table directly, bypassing invariants | DB-per-service: SmartTransfer physically cannot reach the hrms DB; the ONLY path is the command (D-ST-10); arch-guard forbids cross-service SQL/FK | **Critical** | Mitigated (DB-per-service; arch guards) |
| **T**ampering | A replayed/duplicated `apply` double-posts or opens two substantive occupancies | Idempotent on the order id (deterministic messageId; `markProcessed`); the `post_occupancy` EXCLUDE constraint rejects a second substantive holder; a genuine clash becomes an audited `POST_ALREADY_OCCUPIED` refusal | High | Mitigated (#1988 idempotency/concurrency tests) |
| **R**epudiation | Who/when/why of a posting change is lost | The posting FACT (station/state/city-class, from/to office) always rides `audit.event.record` in the same tx, regardless of whether the standalone `hrms.posting.*` events are enabled | High | Mitigated |
| **I**nfo disclosure | The rich posting event leaks personal data to a consumer that is not entitled | `hrms.posting.*` events carry work attributes (office, station, HRA class), **not** Aadhaar/PAN/bank; standalone events are gated off until a wired consumer exists (D-101 ratchet) | Med | Partial (payroll consumer PENDING, D-ST-13) |
| **D**oS | A poison `apply` message crash-loops the consumer | Domain refusals (not-found, SoD, producer-not-authorised) are audited and return (no re-throw); only unexpected errors re-throw to the queue's retry/DLQ | Med | Mitigated |
| **E**levation | The maker of an order also approves it (SoD bypass) | SoD enforced in the consumer when the order carries an approver (maker ≠ approver, house rule 5); no new approval rule invented (D-ST-08/18 PROPOSED) | High | Partial (full competent-authority bands PENDING D-ST-08/18) |

### 2.3 eOffice loop-back (TB3)

| STRIDE | Threat | Mitigation | Sev | Status |
|--------|--------|-----------|-----|--------|
| **S**poofing | A forged e-file decision callback approves a transfer order | Callback arrives only for an allow-listed ref type on the owner topic; estab linkage is the signed source (D-ST-08) | High | Partial (interim: orders stamped "system generated, not digitally signed" until D-ST-12 credentials — PENDING) |
| **T**ampering | The decision outcome (`approved`/`rejected`/`returned`) is altered in transit | Internal transport over the trusted service boundary; tolerant-reader contract (D-18); outcome persisted with reason code | Med | Mitigated (#1985) |
| **E**levation | A new ref type is silently consumed with no decision authority | Opt-in via env, NOT a hard-coded allow-list entry against a PROPOSED decision (no D-101 breach) | Med | Mitigated (#1985) |

### 2.4 Solver / policy sidecars (TB5) — PENDING

| STRIDE | Threat | Mitigation (design intent) | Sev | Status |
|--------|--------|-----------|-----|--------|
| **I**nfo disclosure | PII leaves the trust zone to a JVM/native sidecar or (worse) an external LLM | The `SolverPort`/`PolicyEvaluatorPort` take a **frozen snapshot with opaque ids**, not personal records; no DB credential crosses to the sidecar; no PII to an external LLM until D-ST-17 says otherwise (P07/P11) | **Critical** | PENDING — enforce at M03/M04; spike images already avoid PII (#1978) |
| **T**ampering | A tampered plan is applied as if validated | Deterministic replay (same snapshot+policy hash+seed ⇒ same plan hash); an independent validator checks 0 hard violations before any apply (spec §7.3) | High | PENDING — M04 |
| **E**levation | The solver writes a posting directly | The solver NEVER writes HRMS/Payroll/position masters (spec §7); apply is still the command path (TB4) | **Critical** | Mitigated by design (TB4) |

### 2.5 Evidence store

| STRIDE | Threat | Mitigation | Sev | Status |
|--------|--------|-----------|-----|--------|
| **T**ampering | Decision evidence or audit is altered after the fact | `audit_events` are hash-chained and immutable (audit-service, SECURITY.md §6); `posting_ledger` is append-only (DB trigger rejects DELETE/history rewrite) | High | Mitigated (#1984 append-only tests) |
| **R**epudiation | An auditor cannot reproduce an allocation | §7.3 evidence (snapshot ref, policy hash, solver version, seed, outputs) stored on the run; final approval references the immutable version | High | PENDING — M04/M09 acceptance (§21) |
| **I**nfo disclosure | Controlled downloads of orders/evidence leak PII | Downloads are controlled and access-logged (house rule 9, SECURITY.md §4) | Med | PENDING — M05/M06 download surfaces |

## 3. Residual risks and PENDING items (carried forward)

1. **Transport-level topic ACL.** The producer ACL (TB4) is a consumer-side enforcement of the
   declared contract `owner`; the repo has no per-topic *transport* ACL today. The platform's
   broker credentials + network policy are what keep an unauthenticated writer off the bus. If a
   stronger primitive (signed envelope producer, per-topic broker ACL) is adopted later, TB4 should
   adopt it. Recorded for the SEC workstream; not an M01 blocker.
2. **Signing (D-ST-12, PENDING).** Orders are "system generated, not digitally signed" until ASP
   credentials/empanelment exist. Legal must approve the interim label.
3. **Claims resolver (D-ST-11, PROPOSED).** `office_id`/`jurisdiction_unit_ids` are resolved
   service-side per request for v1; a Keycloak protocol mapper is deferred.
4. **Rate limits / load (spec §15).** Per-route limits are platform-owned; the 10k-session and
   100k-cycle load tests are M09.
5. **AI governance (D-ST-17).** No PII to an external LLM; agents are advisory only. Enforce at M08.

## 4. Mapping to spec §14 controls

| §14 control | Where enforced (M01) |
|---|---|
| 1 Server-derived tenant | `authPlugin` + envelope tenant; never client id |
| 2 Org/jurisdiction authz | `requireRole` + jurisdiction-scoped lists |
| 3 RLS | FORCE RLS on every new table (TB2) |
| 4 Least-privilege service accounts | NOBYPASSRLS runtime roles; scanner role for relay/purge only |
| 5 No unrestricted DB roles | bootstrap asserts no runtime role holds BYPASSRLS |
| 6 No cross-service writes | DB-per-service + `applyPosting` command (TB4, D-ST-10) |
| 7 Protection for sensitive records | PII columns encrypted at rest (`encryptedText`), kept off events |
| 8 Encryption / KMS | TLS 1.3 in transit, AES-256 at rest, `PII_ENC_KEY` (SECURITY.md §4) |
| 9 Maker-checker | SoD in the consumer (house rule 5) |
| 10 Tamper-evident evidence | hash-chained audit + append-only ledger |
| 11 Order integrity | idempotent apply + EXCLUDE occupancy invariant |
| 12 Controlled downloads | PENDING (M05/M06) |
| 13 Retention / access logging | PIA §4; audit on every write |
| 14 Audit of policy edits / overrides | PENDING (M03 Policy Studio; D-ST-18 overrides) |
| 15 Cross-tenant leakage testing | RLS + cross-tenant tests this PR + ST-M01-15b |
