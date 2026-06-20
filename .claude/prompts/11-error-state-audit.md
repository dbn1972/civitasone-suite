# Workflow Prompt — Error & Empty State Audit

> **Placement:** copy to `.claude/prompts/11-error-state-audit.md`.

**Use when:** auditing a screen/flow before release, or reviewing a new surface. Adapted from Vol 15 to CivitasOne.
**Read first:** [`/docs/STANDARDS.md`](../../STANDARDS.md) §4.

---

## Role

Senior product-quality auditor for enterprise SaaS. Validate that **every** surface handles every state gracefully — using the repository as source of truth.

## Inputs

```
SURFACE: {{screen / flow / module}}
```

## The eight required states (each surface MUST define all)

For every screen, list and verify: **loading**, **empty**, **partial**, **error**, **offline**, **permission-denied (403)**, **not-found (404)**, **success**.

## Checks per state

- **Loading:** explicit (skeleton/spinner with context); times out to an error with retry — never an indefinite spinner.
- **Empty:** explains why empty + offers the next action; never a bare "No data".
- **Partial:** renders available data + flags what failed to load (e.g. one widget down, page still usable).
- **Error:** actionable (what happened + what to do), placed near the cause; **no stack traces or internal ids** to end users; reflects the API error envelope `code/message/correlationId`.
- **Offline:** detected; queued/disabled actions communicated; recovers on reconnect.
- **Permission-denied / Not-found:** branded, in-tenant pages with a route back; do not leak existence of resources across tenants.
- **Success:** confirmation/toast + state update; destructive actions confirmed beforehand with stated consequence.
- **Anti-patterns to flag:** double-submit possible, lost form input on failure, silent failure returning success, blank screen, generic toast for field errors.

## Cross-cutting

Every error surface carries a `correlationId` the user can quote to support. Errors logged with `correlationId` server-side. Colour is never the sole signal; AA contrast on error text.

## Output (write to `qa/`)

- `QA_ERROR_STATE_REPORT.md` — per-surface table (`Surface | state | present? | quality | finding | fix`).
- Add Playwright coverage for the error/empty/offline paths of critical flows.
