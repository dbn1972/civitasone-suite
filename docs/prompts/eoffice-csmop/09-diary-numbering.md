# Prompt 09 — System Diary / DAK Numbering (Gap #9 / R9)

## CSMOP basis
CSMOP Ch. 4 (receipt): every inward DAK is **diarised** with a **sequential diary number**
from the central/section diary register. The number is **system-generated and gapless**, not
operator-typed, to prevent gaps and duplicates. One subject ⇒ one file (duplicate-subject
warning on file open).

## What to verify
- `estab_inward.dak_no` — operator-supplied (free text) or allocated like file/dispatch nos?
- File open (`openFileFromInward`/`createFile`) — any duplicate-subject detection?

## Expected control
- `allocateDakNo(tx, tenantId, year)` via `estab_doc_seq` (series `dak`), format
  `DAK/<year>/<6-digit>`, allocated in the `inwardRegister` consumer when none supplied.
- Optional duplicate-subject warning (non-blocking) on file open.

## Remediation (R9)
- `dak_no` defaults to a gapless allocation in the consumer (legacy value honoured if given).
- query: warn when a new file's subject closely matches an existing active file.

## Acceptance check
- Two inwards with no `dakNo` → `DAK/<year>/000001`, `…000002` (gapless).
- Caller-supplied `dakNo` still honoured (legacy/import); typecheck + suite green.
