# Prompt 01 — Organisation Hierarchy (Gap #1 / R1)

## CSMOP basis
CSMOP Ch. 2 establishes the secretariat structure and **levels of functionaries**:
Ministry → Department → Wing → Division → Branch/Section → Desk. File marking, channel of
submission, and level of disposal are all **derived from this hierarchy**.

## What to verify (read, don't assume)
- `services/estab-service/src/modules/operators/schema.ts` — is `division`/`section` free
  text on `estab_file_operator`, or are they FKs into a first-class org-unit entity?
- Any table modelling Ministry/Department/Wing as nodes with `parent_id` + `type` + `code`?
- Is file routing / marking-list derived from hierarchy, or only from operator enrolment?

## Expected control
A first-class `estab_org_unit` entity: `{id, tenantId, parentId, type ∈
(ministry|department|wing|division|section|desk), code, name, active}`, tenant-scoped,
self-referencing tree. Operators and files reference an org unit. Marking lists and channel
of submission are derived from the tree.

## Remediation (R1)
- Migration: `estab_org_unit` (+ unique `(tenant_id, code)`, parent FK, GIN/btree on parent).
- Module `org`: schema, domain (tree validation: no cycles, parent type must be one level up),
  commands/consumer/repo/queries/routes (CQRS).
- Link: add nullable `org_unit_id` to `estab_file_operator` and `estab_files`.

## Acceptance check
- Create a 5-level tree; reject a cycle and a wrong-level parent.
- Resolve the ancestor chain (section → ministry) for a given unit.
- Tenant isolation holds; typecheck + estab suite green.
