# Prompt 08 — NIC eOffice/eFile Parity (Gap #8 / R8)

## Baseline
NIC eOffice/eFile functional set: eReceipt, eFile (with **file cover page**), noting, **draft
template library**, dispatch, DSC/eSign, **VIP/Parliament-question references**, KMS
(knowledge), and **collaboration/messaging** (Spark).

## What to verify
- File cover-page generation? VIP / Parliament-question reference fields on a file?
- Issued copy auto-linked into correspondence? Draft template library (shared with R3)?
- Any collaboration/messaging hook?

## Expected control
- `estab_files` gains `vip_ref`, `parliament_q_ref` (nullable typed refs).
- Cover-page generator (reuse note-sheet-print module pattern).
- Issued DFA copy auto-inserted into `estab_correspondence` on dispatch.
- `estab_dfa_template` library (OM/letter/sanction/notification).

## Remediation (R8)
- Migration: VIP/Parliament columns + `estab_dfa_template`; GRANT to `estab_svc`.
- consumer: on `dfaDispatch`, create an outgoing correspondence row for the issued copy.
- print: file cover page route.

## Acceptance check
- Set VIP/Parliament refs on a file; dispatch a DFA → correspondence row created.
- Cover page renders; templates list returns seeded defaults; typecheck + suite green.
