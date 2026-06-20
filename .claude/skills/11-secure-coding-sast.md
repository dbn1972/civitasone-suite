# Skill — Secure Coding & SAST Defaults

> **Placement:** copy to `.claude/skills/11-secure-coding-sast.md`.

**When to load:** writing or reviewing any handler, repo, integration, IaC, or dependency change. Source: Vol 16 / SAST Master + SECURITY.md §8.

---

## The rule

> Write code that a static security review passes the first time. Every input is validated, every query parameterised, every secret externalised, every cross-boundary access authorised and audited.

## Defaults by vulnerability class

**A. AuthN/AuthZ**
- Authorize on the *object*, not just the route — check the actor owns/▸can-access the specific id (prevents BOLA/IDOR).
- Every query filters by `tenant_id`; cross-tenant only via audited break-glass.
- Verify JWT via `@civitasone/auth` only; check `exp`, signature, issuer; no custom token logic.

**B. Injection / input**
- Drizzle parameterised queries only; **no raw SQL** in app code.
- zod at every boundary; reject unknown keys (`.strict()`), so no mass assignment.
- SSRF: allowlist outbound hosts; block `localhost`/`127.0.0.1`/link-local/private ranges and `javascript:`/`data:`/`ftp:` schemes.
- Output-encode on render; never build HTML from raw input.

**C. Secrets / crypto / data**
- Secrets only from `process.env` ← Vault/Secrets Manager; never committed, never logged.
- `crypto.randomUUID()`/`randomBytes` for tokens — never `Math.random()`.
- No sensitive data in logs, errors, or API responses; redact PII.

**D. API & abuse**
- Per-tenant rate limits at gateway/policy-service; request size limits; idempotency keys on commands.
- Return only fields the caller needs (no over-exposure / `SELECT *` to client).
- Validate file content + MIME, not just extension; cap upload size.

**E. Config / infra / deploy**
- helmet security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options); strict CORS allowlist.
- No debug/verbose errors in prod paths; least-privilege container + deploy creds; no secrets in CI logs.

**F. Dependencies / supply chain**
- Commit lockfiles; pin/verify versions; run `npm audit`/Trivy/Semgrep in CI; avoid risky version ranges.

**G. Governance**
- Every mutation emits an audit event; sensitive replays/exports/break-glass are audited.

## CivitasOne architectural guards (BLOCKER)

- DB login per service; **no cross-database grant** — a service can't reach another's data (L1).
- No `JOIN` across service prefixes (L1) or module schemas (L2); reference by opaque id, no cross-FK.
- No Postgres write in a route handler (writes go via `@civitasone/queue` → consumer → outbox).
- No query-path Postgres read bypassing `@civitasone/cache`.

## Self-check before PR

Run mentally (or via `.claude/prompts/09-sast-security-review.md` on the diff): is there a control I'm *assuming* exists but haven't verified? If so, verify or mark `NOT VERIFIABLE`. Prefer the lower severity unless impact + exploitability are evidenced. No fake CVEs/versions; remediation must match this stack.
