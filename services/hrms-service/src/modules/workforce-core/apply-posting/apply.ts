/**
 * applyPosting — the single posting write path (SmartTransfer OS, ST-M01-09).
 *
 * Spec §4, §11. Decisions: D-ST-09 (consolidate HRMS transfer machinery into
 * one `applyPosting`; PROPOSED, but this row is in the APPROVED M01 list and
 * D-ST-10 — APPROVED — *requires* an applyPosting command because SmartTransfer
 * may only move a posting through it), D-ST-01 (Workforce Core owns Post +
 * effective-dated Occupancy), D-ST-19 (enforce-mode contracts).
 *
 * `applyPostingTx(tx, input)` performs, inside the CALLER'S transaction, the
 * guarded writes that make a posting change (house rule 1 — markProcessed +
 * guarded write + audit all in one tx, done by the consumer that wraps this):
 *   1. load the target post (RLS-scoped) — refuse if unknown;
 *   2. load the employee (RLS-scoped) — refuse if unknown; snapshot the
 *      from-office/station/state/city-class for the rich event;
 *   3. close the previous OPEN substantive occupancy (day before effective) —
 *      so the new one never overlaps and the EXCLUDE constraint never fires in
 *      a correct run;
 *   4. open the new substantive occupancy;
 *   5. append the posting ledger (append-only history);
 *   6. (substantive charge only) update the employee's current office/designation;
 *   7. append a service-book entry;
 *   8. enqueue hrms.posting.applied (authoritative fact) and, when the office
 *      changed, the rich hrms.posting.changed (station/state/cityClass; `ddo`
 *      omitted — no DDO source in Workforce Core today, PROPOSED D-ST-13/14).
 *
 * It is behind WORKFORCE_CORE_LEDGER_ENABLED (checked by the caller). It never
 * emits audit itself — the consumer/caller owns the audit.event.record so the
 * audit trail stays in the one transaction with markProcessed.
 */
import type { Writer } from "./repo.js";
import * as repo from "./repo.js";
import { enqueue } from "../../../shared/outbox.js";
import { HttpError } from "../../../shared/context.js";
import { isPostingEventsEnabled } from "../config.js";

/** Enqueue signature the outbox exposes (tx + event). */
type EnqueueTx = Parameters<typeof enqueue>[0];

/**
 * Posting topic literals (frozen in the #1976 contract pack). Kept as local
 * literals rather than an exported EVENTS-style map so the cross-service-events
 * gate does not advertise them as produced while their consumers are unbuilt
 * (ratchet-safe; see topics.ts). HRMS_POSTING_EVENTS_ENABLED gates emission.
 */
const POSTING_APPLIED_TOPIC = "hrms.posting.applied";
const POSTING_CHANGED_TOPIC = "hrms.posting.changed";

export interface ApplyPostingInput {
  tenantId: string;
  orderId: string;
  employeeId: string;
  postId: string;
  effectiveDate: string;
  orderNumber: string;
  chargeType: string;
  actorId: string;
  correlationId: string;
  /** When supplied, SoD is enforced: maker (actorId) ≠ approver. */
  approvedBy?: string | null;
}

export interface ApplyPostingResult {
  occupancyId: string;
  ledgerId: string;
  officeChanged: boolean;
  fromOfficeId: string;
  toOfficeId: string;
  station: string | null;
  state: string | null;
  cityClass: string;
}

export async function applyPostingTx(
  tx: Writer,
  input: ApplyPostingInput,
): Promise<ApplyPostingResult> {
  // SoD (house rule 5): ADVISORY ONLY. `approvedBy` is caller-supplied and the
  // frozen `hrms.posting.apply` contract carries no approver, so this cannot be
  // an authoritative control; it is enforced only when the order carries an
  // approver. We never invent an approval rule here
  // (D-ST-08/18 PROPOSED) — if no approver is supplied, no SoD check applies.
  // Defence in depth for queue payloads that bypassed the route validator: an
  // impossible calendar date (2027-09-31) would otherwise surface as a raw
  // Postgres data error and loop through retry/DLQ.
  const parsedDate = new Date(`${input.effectiveDate}T00:00:00Z`);
  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== input.effectiveDate
  ) {
    throw new HttpError(
      422,
      "INVALID_EFFECTIVE_DATE",
      `effective date ${input.effectiveDate} is not a real calendar date`,
    );
  }

  if (input.approvedBy && input.approvedBy === input.actorId) {
    throw new HttpError(
      409,
      "SOD_VIOLATION",
      "the maker of a posting order may not also be its approver",
    );
  }

  const post = await repo.findPost(tx, input.postId);
  if (!post) {
    throw new HttpError(
      404,
      "POST_NOT_FOUND",
      `post ${input.postId} not found`,
    );
  }

  const employee = await repo.findEmployee(tx, input.employeeId);
  if (!employee) {
    throw new HttpError(
      404,
      "EMPLOYEE_NOT_FOUND",
      `employee ${input.employeeId} not found`,
    );
  }

  // Only a SUBSTANTIVE posting moves the employee's home office/designation.
  // An acting / additional / in_charge charge coexists with the substantive
  // holding and must leave the employee master (and the office-movement event)
  // untouched.
  const isSubstantive = input.chargeType === "substantive";
  const fromOfficeId = employee.departmentId;
  const toOfficeId = post.officeId;
  const officeChanged = isSubstantive && fromOfficeId !== toOfficeId;

  const posting: repo.OpenPosting = {
    tenantId: input.tenantId,
    employeeId: input.employeeId,
    postId: input.postId,
    officeId: toOfficeId,
    chargeType: input.chargeType,
    effectiveFrom: input.effectiveDate,
    orderRef: input.orderId,
    actorId: input.actorId,
  };

  // Close the previous substantive span the day before the new one begins, for
  // both occupancy and the ledger. Half-open ranges mean an adjacent close/open
  // never overlaps, so the EXCLUDE constraint cannot fire in a correct run.
  // Only applies to substantive postings — acting/additional/in_charge may
  // legitimately coexist with a substantive holder.
  if (isSubstantive) {
    // Ledger dates are inclusive (close the day before); occupancy is
    // half-open [from, to), so it closes AT the new effective date.
    const closeAt = repo.dayBefore(input.effectiveDate);
    const open = await repo.findOpenOccupancyForEmployee(tx, input.employeeId);
    // Half-open occupancy needs to > from (effective > from); the inclusive
    // ledger needs closeAt >= from (same condition). A same-day or back-dated
    // order (effective on/before the day the current span began) cannot close the current span validly:
    // refuse with a domain error (audited by the consumer) instead of letting
    // post_occupancy_dates_check / posting_ledger_dates_check (23514) surface.
    const ledgerStart = await repo.findOpenLedgerSpanStart(
      tx,
      input.employeeId,
    );
    if (
      (open && input.effectiveDate <= open.effectiveFrom) ||
      (ledgerStart && closeAt < ledgerStart)
    ) {
      throw new HttpError(
        409,
        "EFFECTIVE_DATE_NOT_AFTER_CURRENT",
        `effective date ${input.effectiveDate} must be after the start of the employee's current posting`,
      );
    }
    if (open) {
      await repo.closeOccupancy(
        tx,
        open.id,
        input.effectiveDate,
        input.actorId,
      );
    }
    await repo.closeOpenLedgerSpan(tx, input.employeeId, closeAt);
  }

  // Open the new occupancy. A genuine clash (two orders racing for the same
  // post/employee at the same instant) raises the EXCLUDE constraint
  // (23P01) — the consumer maps it to an audited refusal, never a leaked
  // Postgres error.
  const occupancyId = await repo.openOccupancy(tx, posting);
  const ledgerId = await repo.appendLedger(tx, posting);

  if (isSubstantive) {
    const updated = await repo.updateEmployeeCurrentPost(
      tx,
      input.employeeId,
      toOfficeId,
      post.designationId,
      input.actorId,
    );
    if (updated === 0) {
      throw new HttpError(
        404,
        "EMPLOYEE_NOT_FOUND",
        `employee ${input.employeeId} not found`,
      );
    }
  }

  await repo.appendServiceBookEntry(tx, {
    tenantId: input.tenantId,
    employeeId: input.employeeId,
    effectiveDate: input.effectiveDate,
    description: `Posted to office ${toOfficeId} (post ${input.postId}, ${input.chargeType}) per order ${input.orderNumber}`,
    recordedBy: input.actorId,
    documentRef: input.orderNumber,
  });

  // Standalone posting domain events (hrms.posting.applied / .changed). Gated
  // by HRMS_POSTING_EVENTS_ENABLED (default off): their declared consumers are
  // not wired on main yet, so emitting unconditionally would be a
  // publish-into-void orphan that trips the cross-service-events ratchet
  // (D-101). The posting FACT is still carried on audit.event.record (the
  // consumer/caller enqueues it in the same tx) regardless of this flag, so no
  // information is lost when off. See config.isPostingEventsEnabled.
  if (isPostingEventsEnabled()) {
    // Authoritative "a posting was applied" fact (hrms.posting.applied).
    await enqueue(tx as EnqueueTx, {
      topic: POSTING_APPLIED_TOPIC,
      eventType: POSTING_APPLIED_TOPIC,
      tenantId: input.tenantId,
      actorId: input.actorId,
      correlationId: input.correlationId,
      causationId: input.orderId,
      payload: {
        orderId: input.orderId,
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        postId: input.postId,
        chargeType: input.chargeType,
        effectiveFrom: input.effectiveDate,
        orderNumber: input.orderNumber,
      },
    });

    // The RICH office-movement event (hrms.posting.changed): emitted only when
    // the office actually changed. station/state/cityClass come from the
    // employee row (the only sources that exist today). `ddo` is omitted —
    // there is no DDO source in Workforce Core (PROPOSED D-ST-13/14; the
    // contract field is optional).
    if (officeChanged) {
      await enqueue(tx as EnqueueTx, {
        topic: POSTING_CHANGED_TOPIC,
        eventType: POSTING_CHANGED_TOPIC,
        tenantId: input.tenantId,
        actorId: input.actorId,
        correlationId: input.correlationId,
        causationId: input.orderId,
        payload: {
          employeeId: input.employeeId,
          tenantId: input.tenantId,
          fromOfficeId,
          toOfficeId,
          station: employee.station ?? "unknown",
          state: employee.state ?? "unknown",
          cityClass: employee.hraCityClass,
          effectiveFrom: input.effectiveDate,
          orderNumber: input.orderNumber,
        },
      });
    }
  }

  return {
    occupancyId,
    ledgerId,
    officeChanged,
    fromOfficeId,
    toOfficeId,
    station: employee.station,
    state: employee.state,
    cityClass: employee.hraCityClass,
  };
}
