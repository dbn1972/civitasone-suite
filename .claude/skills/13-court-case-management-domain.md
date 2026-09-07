# Skill — Court Case Management Domain

**When to load:** Building anything in `court-service` (case-registry, case-lifecycle, filing, hearing, evidence, notice, order/order-issuance, appeal, scrutiny, certified-copy, cause-list, party, or public-lookup modules).

---

> Court-service is a judicial case-management domain distinct from every other service in the suite (finance, procurement, HR, meetings) — none of the other skill files cover CNR numbering, judicial state machines, or service-of-process. This skill covers the domain invariants specific to it.

## Core invariants (never violate)

1. **CNR (Case Number Record) is a normalized 16-character alphanumeric code.** `normalizeCnr` strips all non-alphanumeric characters and uppercases before validating against a fixed 16-char pattern — never validate a CNR against its display-formatted (separator-containing) form directly.
2. **Every state machine in this service is a strict, per-entity directed graph — never infer an allowed transition from "it seems reasonable."** Case, appeal, hearing, evidence, notice/delivery, order-issuance, scrutiny, defect, and certified-copy each have their own `TRANSITIONS` table in their respective `domain.ts`; check the explicit table, don't reuse another entity's shape even when the state names look similar (e.g. evidence's `admitted`/`rejected` terminal pair is not the same shape as certified-copy's).
3. **Order issuance is maker-checker, enforced in the domain layer, not just at the route.** `order-issuance/domain.ts`'s `assertDifferentApprover` fails closed: a missing/blank maker or approver id is itself a violation, and the comparison is case-insensitive/trimmed so cosmetic id formatting can't defeat it. The maker of a drafted order can never be its approver/issuer.
4. **Money in this service (filing fees, court fees, certified-copy fees) is always non-negative integer paise — no floats, ever.** `filing/domain.ts`'s `assertNonNegativeFee` and `certified-copy/domain.ts`'s `computeCopyFeeMinor` (BigInt paise arithmetic) are the pattern to follow; never introduce a fee computation that isn't integer/BigInt paise.
5. **Server-configured fee schedules are authoritative over client-supplied amounts.** `filing/domain.ts`'s `resolveFees`: when a tenant has a `fee_schedule` config entry for a filing type, the server-side configured amount always wins — a client-supplied fee can never lower or tamper with the actual charge. A malformed configured schedule is a hard failure (poison message), not a silent fallback to the client value.
6. **Tenant-configurable "allowed value" namespaces (case_type, hearing_purpose, evidence_type, party_role, order_type) REPLACE the module defaults when configured — they do not merge with them.** If a tenant configures its own `case_type` list, that list is authoritative and must include every category it still wants; the module's `DEFAULT_CASE_TYPES` (etc.) are pure fallbacks for an unconfigured tenant, never a permanent floor.
7. **Evidence content-hash references must be validated as well-formed SHA-256 hex (64 hex chars) before being trusted as a tamper-evidence anchor.** Use `evidence/domain.ts`'s `validateContentHash` — never persist or compare an exhibit hash that hasn't passed this check.
8. **Deterministic IDs (UUIDv5 over `COURT_NAMESPACE` + a domain-specific name string) are the idempotency mechanism across this entire service.** Every `derive*Id` function (case, hearing, evidence, notice, appeal, party, certified-copy, cause-list) exists so re-submitting the *same* logical record (same tenant + case + distinguishing fields) is a no-op, not a duplicate insert. When adding a new record type, follow this pattern rather than relying solely on a DB unique constraint.

## Case lifecycle state machine

`case-registry/domain.ts` owns the canonical `CaseStatus` transition table; `case-lifecycle/domain.ts` re-exports it rather than redefining it — never duplicate the transition table in a second module.

- Forward spine: `filed → registered → admitted → pending → part_heard → reserved → disposed → appealed`.
- Realistic side-branches are allowed: `part_heard` can return to `pending` or move to `reserved`/`disposed`; `reserved` can return to `part_heard` (further hearing needed) or move to `disposed`; `appealed` re-enters the pipeline as `pending` (in the appellate forum).
- `disposed` and `appealed` are the only "terminal-looking" states, but `disposed → appealed` is a valid edge (a disposed case can still be appealed) — don't treat `disposed` as fully terminal.
- SLA/disposal-target dates are advisory only (`resolveDisposalDays`, default 180 days): a missing or malformed `sla_timer` config value falls back to the default rather than blocking case registration. Never let an SLA computation raise an error that blocks a write.

## Judicial sub-lifecycles (each independent, each with its own state machine)

- **Scrutiny**: `pending → cleared | defective`; a `defective` scrutiny resolves via its own **defect** sub-state-machine (`raised → rectified | waived | rejected`, all three terminal). A case has exactly one scrutiny record (deterministic id on tenant+case) — re-submitting scrutiny for the same case is idempotent, not a new record.
- **Hearing**: `scheduled → held | adjourned | cancelled` (all three terminal for that specific hearing row — an adjournment creates a *new* hearing row for the next date, it does not reopen the old one).
- **Evidence/exhibit**: `submitted → admitted | rejected | marked`, and `marked → admitted | rejected`. `admitted`/`rejected` are terminal. This is a different vocabulary from the evidence *type* (`document`/`photo`/`video`/`audio`/`physical`/`affidavit`/`witness`) — don't conflate the status state machine with the type enum.
- **Notice** (issuance): `issued → served | unserved | cancelled` (terminal). **Delivery** (a specific service-of-process *attempt*, tracked separately per notice): `pending → served | unserved | refused` (terminal). A notice can have multiple delivery attempts; each attempt's id is deterministic on (notice + mode + sequence) so a redelivery of the exact same attempt is a no-op.
- **Appeal**: `filed → registered | withdrawn`, then `registered → allowed | dismissed | remanded | modified | withdrawn` — all five decision/withdrawal outcomes are terminal for the appeal record itself (a remanded appeal's *effect* on the original case is handled via the case's own `appealed → pending` edge, not by reopening the appeal row).
- **Certified copy**: `requested → fee_paid | rejected`, `fee_paid → prepared | rejected`, `prepared → issued | rejected`. A copy can be rejected from any pre-terminal state; `issued`/`rejected` are terminal.

## Notice template rendering

`renderTemplate`/`renderNoticeBody` in `notice/domain.ts` do **plain `{{key}}` token substitution only** — there is deliberately no code evaluation in this path. Missing template variables render as empty string, never throw. Never "upgrade" this to a templating engine that evaluates expressions; that would reopen the exact class of risk `metadata-service`'s rule engine is designed to avoid (see that service's own restricted-grammar pattern if you need inspiration for a *safe* expression language).

## Public lookup (citizen-facing, unauthenticated surface)

- Access mode (`otp` / `captcha` / `open`) is per-tenant configurable via the `public_lookup` config namespace and **defaults to the most private option (`otp`)** for any unrecognized or absent config value — never default to `open`.
- OTP handling: mobile numbers are normalized (digits-only, ≥10 digits) and only ever stored/compared as a peppered SHA-256 hash (`hashMobile`) — the raw mobile number is never persisted for OTP purposes. OTP verification must use `constantTimeEqualHex`, never a plain `===` string compare (timing side-channel).
- `PUBLIC_CASE_FIELDS` is an explicit allow-list of fields ever returned from a public docket lookup — audit/internal columns are never in that list. When adding a new field to the public response, add it to `PUBLIC_CASE_FIELDS` deliberately; never widen the public projection by accident (e.g. via a spread of the full case row).

## Forbidden patterns

- Inferring a state transition because it "feels" allowed instead of checking the entity's explicit `TRANSITIONS` table.
- Letting a client-supplied fee amount override a tenant's configured `fee_schedule` value.
- Using `Math.random()`/non-cryptographic randomness anywhere in the OTP or token path (use `node:crypto`'s `randomInt`, as `public-lookup/domain.ts` already does).
- Comparing an OTP hash or hearing/case identifier with a non-constant-time string compare where the value is security-sensitive.
- Reimplementing the case-status transition table in `case-lifecycle/domain.ts` (or any other module) instead of importing it from `case-registry/domain.ts`.
- Treating a tenant's configured `case_type`/`evidence_type`/`party_role`/`hearing_purpose`/`order_type` list as additive to the module defaults rather than a full replacement.
