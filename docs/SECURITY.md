# CivitasOne Suite — Security & Compliance Standard

**Status:** Binding. Derived from Vol 5 (Security & Compliance Control Matrix) and the SAST Multi-Repo prompts (Vol 16 + Enterprise Master v2.1), adapted to this codebase and the Indian government context (DPDP Act 2023, CERT-In directions).
**Law of the land:** [`/CLAUDE.md`](../CLAUDE.md) §8. This doc is the security program around it.
**Companions:** [ARCHITECTURE.md](ARCHITECTURE.md) · [STANDARDS.md](STANDARDS.md)

---

## 1. Posture

Operate as a **trust-first** platform: security by default, least privilege, explicit trust boundaries, auditable control operation. Every claim in a security/compliance statement must map to a real control owner and verifiable evidence. Controls are classified as **platform-owned**, **tenant-configurable**, or **operationally enforced**.

---

## 2. Control families, owners, evidence (Vol 5)

| Control family | Primary owner | Evidence |
|---|---|---|
| Identity & access | Security eng | Keycloak/auth logs, role reviews, MFA config |
| Data protection | Platform eng | Encryption settings, KMS/Vault rotation records, storage policy |
| Application security | Engineering | Code review, SAST + dependency scans, release gates |
| Audit & logging | Audit/platform | Immutable hash-chained `audit_events`, exports, access records |
| Operational resilience | SRE | Backups, DR drills, runbooks, incident reports |
| Extension security | Platform arch | Plugin manifest reviews, sandbox, revocation records |
| Legal/privacy | Legal/privacy | Published notices, DPA templates, DPDP consent records |

---

## 3. Identity & access (Vol 5 §3)

- SSO via Keycloak (OIDC/SAML), MFA, step-up auth, session revocation, scoped service accounts — all governed.
- Explicit admin boundaries: **platform/super admin** (provider), **tenant admin**, org admin, **security admin**, **audit/compliance admin**, support. (See the `admin-module` consoles.)
- **Break-glass** access requires approval, time-boxing, full audit, and post-use review. Any cross-tenant access without an active break-glass flag triggers an SRE alert.
- Authorization policy changes are high-risk events: audited via `policy.binding.changed` and reviewed.

## 4. Data protection (Vol 5 §4)

- Encryption in transit (TLS 1.3) and at rest (AES-256) is mandatory.
- Secrets centrally managed (Vault / Secrets Manager); **never** exposed to plugins, themes, logs, or committed to source. Key rotation ≤ 90 days.
- **Tenant boundaries preserved everywhere**: storage, cache (per-service keyspace prefix), search, queues, analytics, backups, and exports. This is reinforced by the DB-per-service topology (ARCHITECTURE L1) — a service physically cannot read another's data.
- Data lifecycle defines retention, deletion, restore, legal hold, and export (DPDP data-principal rights).

## 5. Application & platform security (Vol 5 §5)

- Secure SDLC: dependency management, vulnerability remediation SLAs, and **release gating on SAST** (§8 below).
- Maintain a living threat model + abuse-case catalog per service.
- Every new extension point, adapter, or install mode gets a security review.
- Async processing includes retry, poison-message (DLQ) handling, idempotency, and audit for sensitive replays (matches the outbox/consumer pattern).

## 6. Logging, audit & monitoring (Vol 5 §6)

- Every critical action logs actor, tenant, target, `correlationId`, outcome, timestamp.
- Audit covers: auth events, role/policy changes, exports, support/break-glass access, plugin lifecycle, theme publish, install/bootstrap, queue replays/redrive.
- Security telemetry routed to SIEM (platform `security_*`); CERT-In **6-hour incident reporting** automated; ICT logs retained 180 days; NTP time-sync enforced.

## 7. Compliance mapping (Vol 5 §9)

| Framework | Requirement | CivitasOne control | Evidence |
|---|---|---|---|
| DPDP Act 2023 | Consent, data-principal rights, breach notice ≤72h | Consent manager, access/erase workflows, breach runbook | `audit_events`, privacy runbooks |
| CERT-In directions | 6-hour incident report, 180-day logs, NTP | Automated SIEM reporting, log retention, time-sync | SIEM exports, config evidence |
| ISO 27001 / SOC 2 | Access control, change mgmt | Scoped RBAC/ABAC, SSO/MFA, release gates, migration controls | Role reviews, release records |
| Operational resilience | Backup & recovery | Backup policy, DR targets, restore tests | DR drill evidence |
| Extension governance | Third-party code & permissions | Plugin manifest review, sandbox, revocation | Plugin approval records |

> Compliance status is tracked live in the `admin-module` / `platform-module` compliance screens. This table is a control-mapping aid, not a certification.

---

## 8. SAST program — static application security testing (Vol 16 + Master v2.1)

**Gate:** every PR and every release runs the SAST review. **New `Critical` or `High` findings block merge/release.** Run via `.claude/prompts/09-sast-security-review.md`.

### 8.1 Principles (evidence-driven, no hallucination)

- Never assert a control exists unless verified in code/config/IaC/CI/dependency metadata. If unprovable, state `NOT VERIFIABLE FROM PROVIDED CODEBASE`.
- Label every conclusion `Verified` / `Likely` / `Not Verifiable`. Prefer fewer high-confidence findings. When severity is uncertain, choose the lower unless impact + exploitability are evidenced.
- No fake CVEs, no fake package versions, no stack-agnostic remediation, no compliance overclaims.

### 8.2 Review checklist (the seven classes)

- **A. AuthN/AuthZ:** BOLA/IDOR, broken function-level authz, RBAC/ABAC bypass, **missing tenant isolation**, session-invalidation, JWT/token flaws, MFA bypass.
- **B. Injection/Input:** SQL/NoSQL/ORM, command, path traversal, **SSRF**, mass assignment, SSTI, unsafe deserialization, XSS.
- **C. Secrets/Crypto/Data:** hardcoded creds/keys, insecure RNG, crypto misuse, weak hashing, sensitive data in logs/errors/responses.
- **D. API & abuse:** excessive data exposure, missing schema validation, insecure upload, missing size limits / rate limits, replay, business-logic abuse.
- **E. Config/Infra/Deploy:** insecure CORS, missing security headers (CSP/HSTS/X-Frame/X-Content-Type), debug in prod, unsafe containers, CI/CD secret leakage, overprivileged deploy creds.
- **F. Dependencies/Supply chain:** vulnerable deps (only when exact version verified), risky ranges, missing lockfiles/integrity, suspicious deps.
- **G. Governance signals:** code-observable gaps in auditability, access logging, retention, consent.

### 8.3 Finding format

ID · Title · Severity · Confidence · Conclusion type · CVSS 3.1 score+vector · CWE · OWASP (Web/API) mapping · Summary · Root cause · Preconditions · Evidence (`repo|module|file|line|function`) · Exploitation path/PoC · Business + technical impact · Affected-assets table · Remediation (stack-specific) · Post-patch verification. Confirmed secret ⇒ at least `HIGH` + immediate rotation.

### 8.4 Severity bands & scores

`CRITICAL` severe compromise/active exposure · `HIGH` meaningful unauthorized access or strong exploitability · `MEDIUM` constrained · `LOW` defense-in-depth · `INFO` negligible. Do not inflate.

Reports emit a **Security Posture Score (0–100)** — bands: 90–100 Strong · 75–89 Good w/ targeted fixes · 60–74 Moderate · 40–59 High risk · <40 Severe — and a **Code Security Quality Score (0–10)** across authz, authn, input validation, secrets/config, logging/errors, data protection, infra, dependencies, safe patterns, concurrency.

### 8.5 Multi-repo / multi-service handling

Analyze at **module → repository → global** levels. Deduplicate findings only when vulnerability class + root cause + sink pattern + remediation are equivalent; preserve all affected locations. Final verdict per scan: **PASS / CONDITIONAL PASS / FAIL**, plus "what an attacker can do today" and the minimum actions before production.

### 8.6 Secure-coding defaults (prevent the above)

Parameterised queries only (Drizzle); zod at every boundary; output-encode on render; allowlist URLs + block SSRF hosts; validate file content not just extension; helmet security headers + strict CORS at the gateway; per-tenant rate limits at gateway/policy-service; secrets from env/Vault; least-privilege DB logins (one per service); idempotent consumers. The reusable checklist lives in `.claude/skills/11-secure-coding-sast.md`.

---

## 9. Operational resilience (Vol 5 §7)

Backups + restore tests, DR drills (quarterly, a release gate), runbooks, SLOs, incident classification. Self-hosted/on-prem editions publish upgrade, rollback, compatibility, and support boundaries. Capacity planning covers auth load, storage growth, queue throughput, plugin resource usage.

## 10. Extensions (Vol 5 §8)

Plugins run in an approved sandbox/isolated runtime, declare permissions + compatible versions + hook usage + tenant scope, and are revocable. Themes may not suppress legal disclosures, hide security warnings, or alter auth-critical UX.

## 11. Exceptions (Vol 5 §11)

Every control exception is documented with owner, scope, reason, **expiry**, and remediation plan. High-risk exceptions need security + leadership approval. An exception must never silently become the default.
