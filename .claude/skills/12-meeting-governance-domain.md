# Skill — Meeting & Committee Governance

**When to load:** Building anything in `meeting-service` (voting, minutes, attendance, agenda, committee, or participant modules) or anything that reads/writes committee resolutions, quorum state, or meeting minutes.

---

> Full technical design (schema, module layout, API contracts): `civitasone-suite/.kiro/specs/meeting-service/design.md`. This skill covers the domain invariants an agent must not violate when touching this service — it does not repeat the design doc's schema or route catalogue.

## Core invariants (never violate)

1. **Minutes are locked once approved.** `approved` / `signed` / `circulated` minutes can never be edited — only a `submitted` draft can be rejected back to `draft` (the one reverse edge) or approved forward. There is no edge out of `approved` that returns to an editable state.
2. **Every vote result is derived from the total ballots cast (for + against + abstain), not just `for` vs `against`.** Abstentions count toward the base — this makes `unanimous` mean literally 100% of ballots, and makes every super-majority threshold harder to reach than if abstentions were excluded.
3. **Quorum must be re-verified at vote-initiation time, not just at meeting start.** A committee can lose quorum mid-meeting (members leaving); the chairperson cannot initiate a vote if `membersPresent < requiredQuorum` at that moment.
4. **One member, one vote per resolution.** Duplicate-vote prevention is enforced in the domain layer (`assertNoDuplicateVote`) as well as by the DB `UNIQUE(resolution_id, member_id)` constraint — never bypass the domain pre-check even though the DB constraint would also catch it.
5. **A recused member cannot vote and is excluded from that motion's quorum denominator.** Recusal is evaluated per-motion, not per-meeting — a member recused from item 3 can still vote and count toward quorum on item 5.
6. **Agenda ordering is standing → arising_from_minutes → new_business, and reorder must always resolve to a contiguous 1..N sequence with no gaps or duplicates.** Never persist an agenda ordering that isn't a clean bijection over the item set.
7. **A locked agenda (`meeting.status === "agenda_locked"`) rejects all structural mutations** (add / reorder) until a chairperson explicitly unlocks it.
8. **Special invitees are scoped to specific agenda items.** A `special_invitee` participant MUST have at least one `agendaItemIds` entry; every other role must NOT have item scoping. Access to an item outside that scope is denied even for reads.
9. **Minutes' hash chain must never be recomputed from stale content.** `hashCurrent` is always `SHA256(content)`; `hashPrevious` always points at the committee's previous *approved* minutes' `hashCurrent`. Any content edit before approval must NOT be reflected in an already-computed hash — recompute the hash chain link only at the moment of approval/signing.

## Quorum & voting state machines

- **Quorum evaluation** (`committee/domain.ts` `evaluateQuorum`) combines an absolute count (`minMembers`), a roster percentage (`minPercentage`, rounded UP), and optional per-role floors (`roleComposition`). When both an absolute and percentage rule are configured, the **stricter (larger)** resulting count applies. VC-mode attendees only count toward quorum when `rule.vcCountsForQuorum` is true.
- **Membership status** is a small terminal-state machine: `active` ⇄ `suspended`, both of which can move to the terminal states `expired` / `resigned` / `removed`. There is no transition back out of a terminal state — a fresh appointment is a new membership row, not a reopened one.
- **Voting majority rules** (`voting/domain.ts` `computeVoteResult`) use exact integer cross-multiplication, never floating point:
  - `simple_majority`: `votesFor * 2 > total`
  - `two_thirds`: `votesFor * 3 >= total * 2`
  - `three_fourths`: `votesFor * 4 >= total * 3`
  - `unanimous`: `votesFor === total`
  - A vote with zero ballots cast always rejects.
- **Weighted voting** (config-gated `voting.weighted_enabled`) sums ballot *weight* rather than headcount into the same `VoteTally` shape, so `computeVoteResult` scores it identically — when weighting is disabled every weight is 1 and behavior is unchanged from headcount voting.
- Minutes and case-lifecycle-style status machines in this service are all **directed, mostly-forward, with named reverse edges** (e.g. minutes' `submitted → draft` rejection) — never infer a transition is allowed just because it seems intuitively reasonable; check the explicit transition table in the relevant `domain.ts`.

## Attendance vs. quorum computation

- Attendance status counts toward quorum only for `present` and `joined_late` — never `absent`, `left_early`, or (unless `vcCountsForQuorum`) `attending_via_vc`.
- `attendance/domain.ts` re-exports `evaluateQuorum`/`countQuorumEligible` from `committee/domain.ts` rather than reimplementing quorum logic — the two modules must never diverge on what "counts". If you need to change quorum-eligibility rules, change them in `committee/domain.ts` only.
- Real-time **RSVP-based quorum confirmation** (`participant/domain.ts` `computeQuorumConfirmation`) is a *different* computation from live attendance quorum: it tallies `accepted`/`tentative`/`declined`/`pending` invitation responses from quorum-bearing roles (`chairperson`, `member` only — secretary/special_invitee/observer/presenter never count) against a threshold, surfacing `shortfall` for the 48-hour under-quorum alert. Don't conflate this pre-meeting confirmation tally with the in-meeting `evaluateQuorum` check — they use different inputs (invitation status vs. checked-in attendance status) and serve different alerts.
- Joined-late detection compares `checkInAt` strictly after `meeting.actualStartAt`; a meeting that hasn't started yet (`actualStartAt` null) can never produce a "late" check-in.

## Agenda item lifecycle

- Statuses: `proposed → accepted | deferred | withdrawn`, and `deferred → carried_forward` (a new item cloned onto the next meeting of the same committee, with the source item's status set to `deferred` and `deferredTo` linked to the new item's id once it exists).
- Submission deadline defaults to **7 days before** the meeting (`agenda/domain.ts`, configurable via `AgendaConfig.submissionDeadlineDays`); submissions after the cutoff require explicit chairperson approval (`assertSubmissionAllowed`).
- Duration-overrun warnings fire when the sum of *accepted* items' `durationMinutes` exceeds the meeting's scheduled duration by more than 15% (configurable) — items in any other status don't count toward the budget.
- Reordering must be validated as a strict 1..N bijection (`validateReorderBijection`) before being applied; the applied result (`applyReorder`) is idempotent — re-applying the same reorder produces an identical mapping.

## Minutes immutability & hash chain

- Minutes templates are `verbatim` (full discussion + decision per item), `summary` (decision/key point only, no discussion), or `resolution_only` (formal decisions + vote counts, no agenda-item detail at all) — pick the template that matches what the caller actually asked to render; don't silently upgrade a `resolution_only` request into a fuller template.
- Submission deadline defaults to **7 days after** the meeting (note: opposite direction from the agenda submission deadline, which is *before* the meeting), with reminder alerts at 2 days before the deadline and on the deadline itself.
- The hash chain (`computeHash`, `linkHashChain`, `verifyChain`) is the CERT-In tamper-evidence mechanism: each committee's minutes form a chain where `hashCurrent = SHA256(content)` and `hashPrevious` points at the prior approved minutes' `hashCurrent`. `verifyChain` checks both invariants (content-hash match and chain linkage) and reports the first broken record — never "fix" a broken chain by recomputing hashes forward; a break means tampering or a data-integrity bug that needs investigation, not silent repair.

## Committee membership rules

- A membership is valid **as of a date** iff `appointmentDate <= asOf` and (`tenureEnd` is null OR `tenureEnd >= asOf`) — open-ended tenure never expires.
- Tenure-expiring notice window defaults to 30 days: `0 <= daysUntilTenureEnd(tenureEnd, asOf) <= 30`. Already-expired tenures are handled by the expiry path, not the advance-notice path — don't double-alert.
- Committee-level `votingRule` (the majority rule applied to its resolutions) and `quorumRule` (JSONB) are per-committee configuration, not per-meeting — don't let a single meeting's convenience override the committee's configured rule.

## Participant role permissions

- Recognised roles: `chairperson`, `member`, `secretary`, `special_invitee`, `observer`, `presenter`. Only `chairperson` and `member` count toward quorum and are eligible to designate a proxy/nominee.
- A proxy/nominee designation (`participant/domain.ts` `assertNomineeAllowed`) requires: the nominating participant holds a quorum-bearing role, the nominee is not the participant themselves (no self-nomination), and the nominee appears in the committee's `approvedNomineeIds` list.
- A `decline` RSVP response MUST carry a non-empty reason; `accept`/`tentative` responses MUST NOT carry a decline reason — validate both directions, not just the required-on-decline direction.

## Forbidden patterns

- Editing `minutes.content` once `minutes.status` is `approved`, `signed`, or `circulated` (use a new version / new minutes record instead).
- Computing a vote result by comparing `votesFor` against `votesAgainst` alone instead of against `total` (silently ignores abstentions and breaks every majority-rule threshold).
- Initiating a vote without re-checking quorum at that moment (checking only at meeting start).
- Letting a recused member's ballot enter the tally, or counting them in that motion's quorum denominator.
- Persisting an agenda reorder that isn't a gap-free, duplicate-free 1..N sequence.
- Scoping a non-`special_invitee` participant to specific agenda items, or leaving a `special_invitee` unscoped.
- Reimplementing quorum-eligibility logic in `attendance/domain.ts` instead of reusing `committee/domain.ts`'s `evaluateQuorum`/`countQuorumEligible`.
