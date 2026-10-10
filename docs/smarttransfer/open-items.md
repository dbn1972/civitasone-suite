# SmartTransfer OS — OPEN items (depend on PROPOSED decisions)

> Baseline: `origin/main` `9d4fa95e5`. These items are **not decided**. Each depends on a `D-ST` row that is still
> **PROPOSED** in `smarttransfer/M00/DECISIONS.md` (only `D-ST-01, 02, 03, 04, 10, 19, 22, 23` are APPROVED). They are
> recorded here so the C0 pack does not silently assume them. Nothing in this pack treats any of these as settled.

| D-ST | Topic | What is OPEN | Where it appears in C0 |
|---|---|---|---|
| D-ST-05 | Allocation solver runtime | Which solver (TS min-cost-flow baseline / Timefold / CP-SAT). Default is the TS baseline behind `SolverPort` if the spike is skipped; final lock at end of M01 on the pre-registered thresholds. | [state-machines §Allocation run](state-machines.md#allocation-run); [event-list `smarttransfer.solve.*`](event-list.md) |
| D-ST-06 | Solver licensing & hosting | Community vs Enterprise features; JVM base images; data residency. | [ADR-0022](adr/0022-non-node-service-deployment.md); [event-list](event-list.md) |
| D-ST-07 | Policy / rule engine | GoRules ZEN vs extend workflow `dmn` vs in-house evaluator, behind `PolicyEvaluatorPort`. Eligibility, priority and scoring all depend on this. | [state-machines §Request](state-machines.md#transfer-request); [glossary](glossary.md); [api-sketch Eligibility Register](api-sketch.md) |
| D-ST-08 | Approval path | eOffice linkage (new callback types) vs new workflow ref types vs own state machine. Also covers who may cancel a cycle (route and `smarttransfer.cycle.cancelled` topic not in C0). | [state-machines §Cycle/§Order](state-machines.md); [api-sketch committee/approve](api-sketch.md) |
| D-ST-09 | HRMS transfer consolidation | Whether paths A/B/C and deputation become thin callers of `applyPosting`, and whether `hrms.employee.transferred` is superseded. | [api-sketch HRMS command path](api-sketch.md); [event-list existing topics](event-list.md) |
| D-ST-11 | Org/jurisdiction claim source | Service-side resolver (v1) vs Keycloak mapper vs gateway enrichment. | [api-sketch jurisdiction scoping](api-sketch.md) |
| D-ST-12 | Legally valid signing | Extend Aadhaar-eSign adapters vs ship hash-chain labelled unsigned. Interim: orders stamped "system generated, not digitally signed". | [state-machines §Order](state-machines.md#movement-order) |
| D-ST-13 | Payroll consequence scope | Rich posting event + payroll consumer + dated DDO history (recommended) vs full TA/DA vs no payroll effect. | [state-machines §Joining](state-machines.md); [event-list `hrms.posting.changed`](event-list.md) |
| D-ST-14 | Mid-month DDO / city-class source | Source vs destination vs split DDO; X/Y/Z list source. | [event-list `hrms.posting.changed`](event-list.md) |
| D-ST-15 | Authoritative transfer policy | INFORMATION REQUEST — the government orders/rules and a named policy SME. Blocks all rule-pack content. | [glossary Movement Policy/Pack](glossary.md) |
| D-ST-16 | Hold registry consumption | HRMS owns holds; court/vigilance publish into it; eligibility reads it. | [state-machines §Request](state-machines.md); [event-list hold topics](event-list.md) |
| D-ST-17 | Role of AI/ML/LLM | Advisory only, no PII to external LLM until residency settled. Never in the allocation/approval path. | Not surfaced in C0 (no AI in M01 contracts). |
| D-ST-18 | Override / appeal / fairness governance | Who may override, reason codes, dual approval, appeal/overdue windows. | [state-machines §Relieving/§Joining/§Appeal](state-machines.md); [api-sketch exceptions/appeals](api-sketch.md) |
| D-ST-20 | UX4G & language scope | UX4G mandatory? which regional languages? Default planned: en + hi. | [api-sketch i18n note](api-sketch.md) |
| D-ST-21 | Notification gateway & sender id | INFORMATION REQUEST — NIC / state / commercial DLT gateway + sender ids. | Notification consumers in [event-list](event-list.md) (delivery mechanism only). |

These items will be resolved by owner decisions and the M01 spikes (ST-M01-13 solver, ST-M01-14 policy). Until then, any
PR that would depend on one must `STOP_AND_ASK` rather than improvise (`KIRO-BUILD-PROMPT.md` §8).
