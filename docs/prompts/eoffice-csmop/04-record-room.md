# Prompt 04 — Record Room Management (Gap #4 / R4)

## CSMOP basis
CSMOP Ch. 11 + record management: closed/recorded files are **transferred to the record
room**, assigned a **physical location** (rack/shelf/bundle), and tracked in an **issue and
receipt register** when requisitioned and returned.

## What to verify
- `services/estab-service/src/modules/records/schema.ts` — `estab_file_record` holds
  category/retention/review/disposal. Any physical-location fields? Any requisition register?
- Is there a `transferred_to_record_room` state distinct from `closed`?

## Expected control
- `estab_file_record` gains `rack`, `shelf`, `bundle_no`, `record_room_id`.
- `estab_record_requisition` register: `{file_id, requested_by, issued_at, due_back,
  returned_at, status ∈ (requested|issued|returned|overdue)}`.
- State `transferred_to_record_room` on transfer.

## Remediation (R4)
- Migration: add location columns + `estab_record_requisition`; GRANT to `estab_svc`.
- commands/consumer: `transferToRecordRoom`, `requisitionFile`, `returnFile`.
- query: outstanding requisitions, overdue list.

## Acceptance check
- Transfer a closed file to record room with rack/shelf; requisition then return it.
- Overdue requisition surfaces in the register; typecheck + suite green.
