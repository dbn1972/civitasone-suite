# Skill — Form & Input Validation

> **Placement:** copy to `.claude/skills/10-form-and-input-validation.md`.

**When to load:** building or reviewing any form, DTO, or input boundary. Source: Vol 9 + STANDARDS §3.

---

## The rule

> The backend never trusts the frontend. Define each rule once as a shared `zod` schema, validate on both sides, reject invalid payloads even when the UI is bypassed, and surface errors identically.

## Single source of truth

```ts
// @civitasone/types — shared schema, imported by web, mobile, and the service
export const createVaultSchema = z.object({
  name: z.string().trim().min(2).max(120),
  classification: z.enum(["public","internal","confidential","secret"]),
});
```

- Frontend uses it for inline validation; the service uses it at the route boundary; the test suite uses it to generate valid/invalid cases.
- Backend rejection of a bypassed UI is **mandatory and tested** (curl the endpoint with junk).

## Field-class rules (enforce all that apply)

| Class | Rule |
|---|---|
| Required | reject empty, whitespace-only, `null`/`undefined`/`None` strings, omitted keys, unselected required control, empty file |
| Length | min / max enforced; state the limit in the message; backend rejects oversize (413) |
| Format | email, phone, money (bigint minor), date — business-readable error |
| Special/Unicode | safely store & re-render `<script>`, `' OR '1'='1`, quotes, emojis, RTL, Indic/Arabic/CJK; no XSS/injection |
| Duplicate | specific 409 conflict message |
| URL | block `javascript:`/`data:`/`ftp:`/localhost/127.0.0.1/private IPs (SSRF); HTTPS where sensitive |
| File | validate content + MIME, block double-extension, size limit, preserve metadata on failure |
| Numeric/date | bounds, start≤end, retention limits, reject tampered options server-side |

## Error surfacing

Backend returns the standard envelope with `fieldErrors`; frontend maps each `fieldErrors[].field` to its input — never a generic toast. Move focus to the first invalid field. Preserve all entered data on failure. Prevent double-submit; reset the submit button.

## Network-failure UX

Handle 400/401/403/404/409/413/422/429/500, timeout, offline, slow: clear message, no blank screen, no infinite spinner, safe retry, no silent data loss.

## Accessibility

Visible label/accessible name per input; errors programmatically associated (`aria-describedby`) and announced; required state announced; keyboard-only; visible focus; modal focus-trap + `Esc`; colour never the sole error signal; AA contrast.

## Testing

Playwright E2E per module under `tests/e2e/forms/`; component tests for inline rules; backend tests for DTO/zod + bypass rejection. Role/label/text selectors; mock API failures; no brittle selectors, sleeps, or retry-masking.
