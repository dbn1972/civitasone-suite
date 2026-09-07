# Skill — Visitor Management Domain

**When to load:** Building anything in `visitor-service` (visit-request, check-in, digital-pass, recurring-pass, group-visit, material-pass, vehicle-pass, blacklist, identity, badge-print, turnstile-control, device-registry, config-registry, evacuation, or dpdp modules).

---

> Visitor-service is a gate-security/access-control domain distinct from every other service in the suite — none of the other skill files cover pass verification, blacklist screening, or physical-access state machines. This skill covers the domain invariants specific to it. `05-multi-tenant-isolation.md` and `11-secure-coding-sast.md` still apply on top of this (tenant isolation, no raw SQL, etc.) — this file is additive, not a replacement.

## Core invariants (never violate)

1. **Blacklist matches are silently blocking; watchlist matches are silently flagging.** `screenIdentity` returns `blocked` (blacklist hit — reject entry, never disclose the reason to the visitor) and `flagged` (watchlist hit — allow entry, but surface a security flag to host/security officers). Never merge these two outcomes or disclose a blacklist reason in an API response.
2. **Blacklist entry approval is maker-checker.** `assertDistinctMakerChecker` rejects self-approval (creator === approver). A blacklist entry only becomes `active` (enforced during screening) after a *different* user approves it — the `pending` state exists specifically to gate this.
3. **A digital pass's QR verification decision is a strict AND-chain, evaluated in a fixed order:** signature/claims valid → not revoked → correct location scope → correct zone/area scope → not blacklisted. Never skip a step or reorder them (skipping straight to blacklist check before confirming location scope would leak scope information via timing/error differences).
4. **Revoking a pass must make subsequent verification/check-in fail immediately.** `assertNotRevoked` / the `PASS_REVOKED` check in gate verification has no grace period — there's no such thing as a "still valid for N more minutes" revoked pass.
5. **Check-in requires a preceding check-out before re-entry, unless the pass is a multi-entry recurring pass.** The state machine allows `checked_in → checked_out → checked_in` (multi-day/recurring re-entry) but rejects `checked_in → checked_in` (`PASS_ALREADY_CHECKED_IN`) unless `passType === "recurring" && multiEntryRecurring === true`.
6. **Parking-slot occupied/available counts must always be derived from the live slot list, never tracked as a separate counter.** `computeSlotCounts` partitions the same slot rows into occupied/available so `occupied + available === total` holds by construction — never add a standalone incrementing/decrementing counter for slot occupancy that could drift.
7. **Group-visit blacklist screening isolates the flagged member — it never blocks the rest of the group.** `screenGroupMembers` returns a per-member result; a single blacklist match must not short-circuit or reject the other members' passes.
8. **Material-pass exit discrepancy is driven only by missing declared items, never by extra/undeclared items.** `reconcileOnExit`'s `discrepancy` flag is `true` iff a *declared* item is unaccounted for. Items present at exit that were never declared are a *separate* signal (`handleUndeclaredItemOnExit`) — don't fold the two into one discrepancy flag; they represent different security concerns (missing vs. unauthorized removal).

## Pass verification & revocation

- QR tokens are RS256-signed JWTs (`signPassQr`/`verifyPassQr` in `shared/qr-crypto.ts`) carrying `location_id` and `permitted_areas` claims. `isLocationScopeValid` requires an exact match on `location_id`; `isAreaPermitted` treats a `null` gate `areaId` as a perimeter gate that any location-scoped pass may use, while a non-null `areaId` (zone-boundary gate) requires that area to be explicitly listed in the pass's `permitted_areas`.
- `classifyQrError` maps `jose`'s thrown error codes to a closed set of reasons (`invalid_signature` | `expired` | `not_yet_valid` | `malformed`) and **fails closed**: any unrecognized error code is classified as `invalid_signature`, never treated as valid.
- Pass validity windows (`computeValidityWindow` in `digital-pass/domain.ts`) are capped per pass type: `multi_day` defaults to 7 days from `requestedFrom`, `recurring`/`event` defaults to 90 days — both caps are config-overridable via the tenant's `visitor_policy`, but the module default applies unconfigured. `recurring-pass/domain.ts` enforces the same 90-day cap independently at request time (`RECURRING_PASS_MAX_DURATION`) — this is deliberate belt-and-braces, not a bug to "deduplicate."

## Check-in / check-out & schedule enforcement

- Attendance-relevant state machine: `active`/`issued` (pre-use) → `checked_in` → `checked_out` → (re-entry) `checked_in`. `revoked`/`expired` are absorbing states reachable from `active`.
- Recurring-pass check-in eligibility (`isEligibleForCheckIn`) checks, in order: pass status (`suspended`/`revoked`/`expired` all block), permitted day-of-week, then permitted time-of-day window (inclusive on both ends) — a `null` time window means day-of-week-only restriction, not "no restriction at all."
- Visit duration (`computeVisitDurationMs`) requires `checkOutAt` strictly after `checkInAt` — a zero or negative duration throws rather than silently clamping to zero.
- Overstay detection (`isOverstayed`) compares against `validUntil + graceMs`, where `graceMs` defaults to 0 and is config-driven per tenant (`check_in.overstay_grace_minutes`) — never hardcode a grace period in a call site; read it from config so tenant behavior stays consistent with what they've configured.

## Group visits, material passes, vehicle passes

- Group size must be a strict integer in `[2, 200]` (`isValidGroupSize`) — a "group" of 0 or 1 is invalid, not just discouraged.
- Material-pass item matching (declared vs. presented-at-exit) keys on serial number when present (case-insensitive), else on trimmed/lowercased description — never match items by array position or insertion order.
- Vehicle parking category resolution (`resolveParkingCategory`) is a fixed mapping: `two_wheeler`/`bus` always park by vehicle shape regardless of visitor category; `car`/`suv`/`truck` park by visitor category (`vip`/`standard`/`handicapped`). Don't invent a "VIP two-wheeler" or "handicapped bus" category — the slot taxonomy doesn't have one.
- Bulk check-in headcount reconciliation (`confirmBulkCheckIn`) is advisory (returns a discrepancy result) rather than blocking — a headcount mismatch must not prevent the group's check-in flow from completing; it surfaces a warning instead.

## Config namespaces (per-tenant, allow-list semantics)

- `config-registry/domain.ts`'s `effectiveAllowed`: an empty configured-keys list falls back to the module default set; a configured set containing the sentinel `"none"` means "no members are allowed" (an intentional empty override, distinct from "not configured"); any other non-empty configured set REPLACES the default entirely (it does not merge with it). This mirrors the same allow-list-replaces-not-merges pattern used by `court-service`'s `case_type`/`evidence_type`/etc. namespaces — apply it consistently if you add a new configurable namespace here.

## Forbidden patterns

- Disclosing a blacklist match's underlying reason to the visitor or in a client-facing error message.
- Allowing the same user to be both maker and checker on a blacklist entry approval.
- Reordering or skipping steps in the gate-verification AND-chain (signature → revocation → location → zone → blacklist).
- Treating a revoked pass as valid for any grace window.
- Tracking parking-slot occupied/available counts with a separate incrementing counter instead of deriving them from the slot rows.
- Letting a group-visit blacklist match on one member block or delay the rest of the group's passes.
- Folding "undeclared item at exit" into the same discrepancy flag as "declared item missing at exit."
