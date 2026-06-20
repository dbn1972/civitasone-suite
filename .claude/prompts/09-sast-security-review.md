# Workflow Prompt — SAST Multi-Repo Security Review

> **Placement:** copy to `.claude/prompts/09-sast-security-review.md` (this session cannot write `.claude/` directly).

**Use when:** Release gate, quarterly review, or before exposing a service to the internet. Runs across the whole monorepo (all `services/*`, `packages/*`, `apps/*`, `infra/*`). Adapted from Vol 16 + SAST Enterprise Master v2.1 to CivitasOne.

**Read first:** [`/docs/SECURITY.md`](../../SECURITY.md) §8, [`/CLAUDE.md`](../../../CLAUDE.md), skill `11-secure-coding-sast.md`.

---

## Role

Senior application security engineer. Think as attacker, secure-code reviewer, security architect, and API/cloud reviewer. Be evidence-driven and conservative — suitable for a high-assurance government deployment.

## Core rules (non-negotiable)

- Do not hallucinate findings, controls, package versions, exploitability, or environment facts.
- Do not assume a control exists unless verified in code/config/IaC/CI/dependency metadata. If unprovable: `NOT VERIFIABLE FROM PROVIDED CODEBASE`.
- Label every conclusion `Verified` / `Likely` / `Not Verifiable`. Prefer fewer high-confidence findings. If severity is uncertain, pick the lower unless impact + exploitability are evidenced.
- No fake CVEs, no fake versions, no stack-agnostic remediation, no compliance overclaims.

## Inputs

```
SCOPE: {{repos / services / packages — default: whole monorepo}}
INTERNET-EXPOSED SERVICES: {{list, or "unknown"}}
CHANGED SINCE: {{commit/tag for incremental gate; omit for full}}
```

## Execution

1. **Discovery & coverage.** Enumerate services, modules, languages, entry points, auth boundaries, data stores, outbound integrations, CI/CD + IaC. Report total services, modules/service, files discovered, files reviewed, coverage %, skipped files + reason.
2. **Prioritise:** routes/entry points → auth/authz/middleware/policies → handlers/services/domain → repos/ORM/migrations → validators/DTOs/zod → config/secrets → infra/deploy → dependency manifests/lockfiles → crypto/token → integrations/jobs/queues.
3. **Review the seven classes** (SECURITY.md §8.2): A AuthN/AuthZ (incl. **tenant isolation** + BOLA/IDOR), B Injection/Input (incl. **SSRF**), C Secrets/Crypto/Data, D API & abuse, E Config/Infra/Deploy, F Dependencies/Supply-chain, G Governance signals.
4. **CivitasOne-specific BLOCKER checks:**
   - Any service whose DB login can reach another service's database (L1 breach) — verify grants in `infra/db`.
   - Any `JOIN`/query crossing service prefixes (L1) or module schemas (L2).
   - Any Postgres write inside a route handler (must go via queue/consumer — CLAUDE.md §6).
   - Any query-path Postgres read bypassing `@civitasone/cache`.
   - Any mutation missing an audit event; any query missing `tenant_id` scoping; any cross-tenant read without break-glass.
   - Secrets/URLs/env values hardcoded; `console.log/error` in product code.
5. **Consolidate** module → repository → global. Deduplicate only when class + root cause + sink + remediation are equivalent; preserve all affected locations.

## Finding format (each)

ID · Title · Severity · Confidence · Conclusion type · CVSS 3.1 score+vector · CWE · OWASP Web/API mapping · Summary · Root cause · Preconditions · Evidence (`repo|module|file|line|function` + snippet) · Exploitation path/PoC · Business + technical impact · Affected-assets table (`Repo|Module|File|Line|Function/Endpoint|Verdict`) · Stack-specific remediation · Post-patch verification. Critical/High also: attacker path, blast radius, internet-exposure verdict. Confirmed secret ⇒ ≥ HIGH + rotation.

## Output (write to `security/`)

- `SAST_civitasone_SECURITY_REPORT.md` — global deduplicated master report.
- `SAST_<service>_REPORT.md` — per-service summaries as space allows.

Master structure: Executive Summary (Security Posture Score 0–100 + Code Security Quality Score 0–10 + coverage stats) → Scope & Coverage → Scan Topology (`Service|Modules|Files|Crit|High|Med|Low|Info`) → Method & Confidence Limits → Global/Critical/High/Medium/Low/Info findings → Authorization & Trust-Boundary Review → API Security → Secrets & Config → Dependency & Supply-Chain → Business-Logic Abuse → Per-service Summaries → Remediation Roadmap → **Final Verdict (PASS / CONDITIONAL PASS / FAIL** + what an attacker can do today + minimum actions before production).

## Gate

**FAIL or any new Critical/High ⇒ block merge/release.** Record the score trend; it must not regress.
