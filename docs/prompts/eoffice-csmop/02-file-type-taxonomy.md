# Prompt 02 — File-Type Taxonomy (CSMOP "Types of files")

## CSMOP baseline
CSMOP recognises several file types beyond an ordinary current file:
- **Part file** — opened when the main file is away and work cannot wait; later
  merged into the main file.
- **Volumes** — a bulky file is split into Volume I, II, III … the file number
  stays the same; a new volume opens when a page threshold is crossed.
- **Linked files** — files put up together because they bear on one another.
- **Standing guard file** — a permanent reference file of consolidated
  instructions/precedents.
- **Ephemeral ("p"/routine) file** — short-life, destroyed without formal review.

## What to verify in code
- Does `estab_files` model a file *type* and *volume number*?
- Can files be *linked* to each other (many-to-many)?
- Is there auto-creation of Volume II when a file exceeds a page threshold?

## Gap (from current code)
`estab_files` has only `classification` + `status` (`draft/active/closed/
archived`) and a single `parent_file_id`. **No part/volume/linked/standing-guard/
ephemeral taxonomy.** Severity: **High** (≈25%).

## Remediation (R2)
- Add to `estab_files`: `file_type text not null default 'main'`
  (`main|part|volume|linked|standing_guard|ephemeral`),
  `volume_no integer not null default 1`,
  `linked_file_ids uuid[] not null default '{}'`.
- Pure domain helpers: `isValidFileType`, `canOpenVolume`, `nextVolumeNo`.
- Commands: `openPartFile(parentId)`, `openVolume(parentId)`,
  `linkFiles(a, b)` / `unlinkFiles(a, b)`. Volume inherits the parent's
  `file_no` and increments `volume_no`; part file references parent.
- Queries expose `file_type`, `volume_no`, `linked_file_ids`.

## Test plan
- `nextVolumeNo` increments; part file points at parent; link is symmetric.
- Invalid `file_type` rejected by zod.
- Tenant isolation on link operations.
