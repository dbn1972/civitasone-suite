# Workflow Prompt — Form Validation Quality Audit

> **Placement:** copy to `.claude/prompts/10-form-validation-audit.md`.

**Use when:** auditing a module's forms before release, or building a new form-heavy screen. Adapted from Vol 9 to CivitasOne.
**Read first:** [`/docs/STANDARDS.md`](../../STANDARDS.md) §3–4, skill `10-form-and-input-validation.md`, skill `08-accessibility-wcag-22.md`.

---

## Role

Senior QA engineer + product-quality auditor + accessibility reviewer + enterprise-SaaS validation specialist. Goal: not "does it submit" but "does every form behave like a world-class enterprise product — clear, safe, accessible, consistent, resilient." Use the **repository as source of truth**; validate the actual implementation, not assumptions.

## Inputs

```
MODULE: {{e.g. tenant, finance, procurement, citizen}}
FORMS: {{list, or "all in module"}}
```

## Per-form test classes (run every applicable one)

1. **Empty/missing** — empty, whitespace-only, `null`/`undefined`/`None` strings, omitted API keys, unselected required dropdown/checkbox, empty file. Expect: no submit, field-level error, focus to first invalid field, no server crash.
2. **Format** — email (`abc`, `abc@`, `a b@x.com`, `+addressing`, very long), phone, money (bigint minor units), URL. Clear non-technical errors.
3. **Length/boundary** — 1, min−1, min, max, max+1, extreme 5k–50k chars. Limits stated; layout unbroken; backend rejects oversized (413).
4. **Special chars/Unicode** — `<script>`, `' OR '1'='1`, quotes, emojis, RTL, Hindi/Odia/Bengali/Arabic/Chinese, newlines/tabs/leading-trailing spaces. No XSS, no injection, safe re-render after save.
5. **Duplicate/conflict** — specific 409 message (not generic).
6. **URL** — reject `javascript:`, `data:`, `ftp:`, localhost/127.0.0.1/private IPs (SSRF); require HTTPS where sensitive.
7. **File upload** — no file, bad extension, MIME spoof, double-extension (`x.pdf.exe`), empty, oversize, Unicode/special filename, corrupt, slow/interrupted/offline upload. Validate content not just extension; preserve entered metadata on failure.
8. **Numeric/date/selection** — negatives/zero, decimals, huge numbers, invalid/past/future date, start>end, retention bounds, tampered dropdown option via API, empty multi-select.
9. **Network/API failure** — 400/401/403/404/409/413/422/429/500, timeout, offline, slow. Expect: clear error, no blank screen, no infinite spinner, submit resets, no double-submit, no silent data loss, safe retry.

## Frontend ↔ backend consistency

For each form list: frontend rules, backend zod/DTO rules, API error format. Flag every mismatch (FE allows but BE rejects / BE allows but FE rejects / BE returns technical error / differing limits / required field missing in one layer). **The backend must reject invalid payloads even when the UI is bypassed.**

## Accessibility (WCAG 2.2 AA)

Labels/accessible names, errors programmatically associated + announced, required announced, keyboard-only, logical tab order, visible focus, modal focus-trap + `Esc`, colour not the only error indicator, AA contrast.

## Output (write to `qa/`)

- `QA_FORM_VALIDATION_REPORT.md` — findings + severity + repro + fix.
- `QA_FORM_VALIDATION_MATRIX.md` — form × test-class pass/fail grid.
- Add/extend Playwright specs under `tests/e2e/forms/<module>-forms.spec.ts` using role/label/text selectors and mocked API failures. No brittle CSS selectors, no sleeps, no retry-masking.
