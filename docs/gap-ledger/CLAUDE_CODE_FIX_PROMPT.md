# Prompt for Claude Code — fix the CivitasOne gaps

Paste this into Claude Code from the repo root (`civitas-suite`).

---

You are fixing verified UI/UX and integration gaps in the CivitasOne web app. Read `CLAUDE.md` first; its rules are binding (money in paise, audit events on mutations, zod at the boundary, DB per service, no cross-module SQL joins, no console.log).

Inputs in `redesign/gaps/`:
- `SHARED_FIXES.md` — 20 systemic fixes. **Do these first, one PR each.** Many per-page items vanish afterwards.
- `PRIORITY_QUEUE.md` — sensitive confirmed items; do these next, with extra review.
- `<module>.md` — detailed per-page items. Each has verdict, evidence, files, fix steps, acceptance checks, dependencies, effort, risk.
- `BACKEND_CHECKLIST.md` — claims about services not present here; verify against the service repo, add tests, and only change web code if the check fails.
- `gaps.json` — same data, machine-readable (fields: id, module, page, verdict, bucket, theme_final, fix_steps, acceptance, depends_on).

Rules:
1. **Skip items whose bucket is REFUTED** (they are at the bottom of each module file). Never implement CANNOT-VERIFY or BACKEND-VERIFY items without the named service or a written decision.
2. Items with `Needs: decision` — stop and ask the owner; do not guess (pay-matrix, role changes, PII visibility, marketing claims).
3. Honour `Depends on` ordering. Verify the evidence line numbers before editing — they can be off; the mechanism matters, not the number.
4. One module at a time, one page at a time. After each page: run type-check, lint, and the tests; check the item's Acceptance list; tick `[x]` in the module file with a one-line note; commit `fix(<module>): GAP-… ` referencing ids.
5. Do not touch money math, approval/maker-checker flows, or PII exposure without adding a test and flagging the PR for human review.
6. If the code no longer matches the evidence, mark `[~]` with the reason instead of forcing a change.
