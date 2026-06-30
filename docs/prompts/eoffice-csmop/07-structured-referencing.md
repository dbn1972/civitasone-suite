# Prompt 07 — Structured Referencing (CSMOP "Referencing")

## CSMOP baseline
A noting refers to: the **PUC** and page ranges; **rules** (FR/SR, GFR, FRSR,
delegation of financial powers); **precedent files**; **financial concurrence**;
**legal opinion**; and **annexures**. These references must be **stable** (survive
re-pagination) and **navigable**.

## What to verify in code
- Are references typed objects, or only free-text in note bodies + PUC link?

## Gap (from current code)
Page ranges + PUC link exist; rule/precedent/cross-file references are free-text
in notes. **No structured, typed reference objects.** Severity: **Medium** (≈50%).

## Remediation (R7)
- `estab_reference (id, tenant_id, file_id, note_id, ref_type
  (puc|rule|precedent_file|concurrence|legal_opinion|annexure|cross_file),
  ref_value, label, target_file_id, page_from, page_to, …)`.
- Commands `addReference` / `removeReference`; query `listReferences(file_id)`
  and `listReferences(note_id)`.
- Cross-file references are tenant-scoped and validated against existing files.

## Test plan
- Add each ref_type; invalid type rejected by zod.
- Cross-file ref to another tenant's file rejected.
- References survive a note edit (stable by id, not by text).
