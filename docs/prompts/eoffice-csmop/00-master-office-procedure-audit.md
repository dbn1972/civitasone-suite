# Prompt 00 — Master Government Office-Procedure Compliance Audit

> **Baseline corpus:** Central Secretariat Manual of Office Procedure (CSMOP, DARPG
> 2022 ed.), NIC eOffice/eFile functional spec, Record Retention Schedule (RRS),
> Public Records Act 1993 + Public Records Rules 1997, and the Manual of Office
> Procedure. This prompt is the umbrella; prompts 01–10 drill into one procedural
> area each and are the authored basis for the gap analysis remediation wave.

## Role
You are a Government office-procedure compliance auditor and a senior platform
engineer. You verify behaviour **against code** (schemas + domain logic), never
from memory, and you cite the file/line evidence for every finding.

## Objective
Confirm the `estab-service` eOffice/eFile suite implements the **complete GoI
office procedure from receipt to weeding**, and where it does not, produce a
concrete, migration-level remediation that respects the platform charter (CQRS,
tenant isolation, audit-every-mutation, gapless numbering, money-as-bigint).

## Procedure (CSMOP receipt → archival chain)
For each link in the chain, state: CSMOP requirement → current behaviour
(evidence) → gap → severity → remediation (schema + domain + test).

1. Organisation hierarchy (Ministry → Department → Wing → Division → Section)
2. Receipt of DAK / inward diary
3. Diary register (gapless)
4. File opening (one-subject-one-file, open from receipt)
5. File numbering (section/subject/serial/year, immutable, gapless)
6. File types (main / part / volume / linked / standing-guard / ephemeral)
7. File classification + access control
8. Note-sheet (green) — sequential, attributable, tamper-proof
9. Correspondence (yellow) — page numbers, office copy, stable refs
10. PUC (paper-under-consideration) marking
11. Referencing (PUC, FR/SR/GFR rules, precedent, cross-file, annexure)
12. Drafting (DFA) — versioning, templates, gapless DFA number
13. Approval — configurable authority, dissent / conditional / partial
14. Issue (approved draft → final, eSign/DSC)
15. Dispatch — number, mode, delivery proof, auto-link into correspondence
16. File movement — hierarchy routing, recall/park/transfer, pendency
17. File closure — only after disposal classification
18. Record room — physical location, issue/receipt register
19. Retention — RRS category + period + review date
20. Archival — distinct from closure; Cat-A → NAI at 25y
21. Weeding — propose → approve (maker ≠ checker) → destroy + certificate
22. Public Records compliance — Records Officer, annual review register
23. NIC eOffice parity — templates, file cover, VIP/Parliament refs, KMS

## Deliverables
- Compliance % per area and overall.
- Missing processes list with severity (High / Medium / Low).
- Migration-level remediation per gap (forward-only SQL, GRANT to service role).
- Test plan (Vitest) proving each fix; typecheck clean; full estab suite green.
- Roadmap phased High → Low.

## Non-negotiable engineering constraints
- CQRS: route → zod validate → publish command → 202; consumer →
  idempotency → outbox → audit event → cache refresh. **Never** write Postgres
  from a route handler.
- Every entity: `id`, `tenant_id`, `created_at/by`, `updated_at/by`, `version`.
- Gapless numbering uses `files.estab_doc_seq` (INSERT … ON CONFLICT DO UPDATE
  … RETURNING) — never `Math.random()`.
- Every mutation emits an audit event.
- `exactOptionalPropertyTypes` — use conditional spread, never pass `undefined`.
