/**
 * applyPosting — thin-caller bridge for the legacy transfer paths
 * (SmartTransfer OS, ST-M01-09).
 *
 * Paths A (direct `employee/consumer.ts` + the deferred-effective scheduler),
 * B (eOffice `lifecycle/eoffice-consumer.ts`) and the deputation flow all move
 * an employee by DEPARTMENT/office, carrying no sanctioned `post` id — the
 * post/occupancy model (ST-M01-07) is new and no backfill has mapped the legacy
 * office+designation to a `workforce_core.post` yet (that is ST-M01-08). So,
 * when WORKFORCE_CORE_LEDGER_ENABLED is on, these paths become thin callers of
 * `recordLegacyPostingLedger`, which records the one thing they CAN produce
 * without a post:
 *   • the dated posting-ledger span the legacy overwrite never kept (M00
 *     §B-hr: `applyTransferEffect` overwrote the employee row with no tenure
 *     trail) — post_id is NULL (the ledger allows it), office-keyed; and
 *   • the rich `hrms.posting.changed` office-movement event (station/state/
 *     city-class from the employee row; `ddo` omitted — no source today).
 *
 * It deliberately does NOT open `post_occupancy` (post_id is NOT NULL there —
 * the one-holder-per-post EXCLUDE invariant is meaningless without a post) and
 * does NOT emit `hrms.posting.applied` (that event's contract REQUIRES a
 * postId, which the legacy path does not have). The full occupancy write and
 * the `.applied` fact belong to the explicit `applyPosting` command path, which
 * carries a real post. This is called from INSIDE the caller's existing
 * transaction, so the ledger span and the event commit atomically with the
 * employee-master update. When the flag is OFF this is never invoked and the
 * legacy path is byte-for-byte unchanged.
 */
import type { Writer } from "./repo.js";
import * as repo from "./repo.js";
import { enqueue } from "../../../shared/outbox.js";
import { isPostingEventsEnabled } from "../config.js";
import { randomUUID } from "node:crypto";
import { pino } from "pino";

const log = pino({ name: "workforce-core-legacy-bridge" });

type EnqueueTx = Parameters<typeof enqueue>[0];

/** Frozen-contract topic literal (see apply.ts / topics.ts for the ratchet note). */
const POSTING_CHANGED_TOPIC = "hrms.posting.changed";

export interface LegacyPostingInput {
  tenantId: string;
  employeeId: string;
  /** The employee's office BEFORE this move (for the rich event's fromOffice). */
  fromOfficeId: string;
  /** Destination office/department (the only "where" the legacy path has). */
  toOfficeId: string;
  effectiveDate: string;
  /** The order number/ref, when the path recorded one. */
  orderRef: string | null;
  actorId: string;
  correlationId: string;
}

/**
 * Append the dated posting-ledger span for a legacy transfer and emit the
 * rich office-movement event, inside the caller's transaction. Idempotency is
 * owned by the caller (markProcessed on the originating command already ran in
 * the same tx), so this is a plain append; a redelivery never reaches here
 * twice. Only runs for a genuine office change (same-office "transfers" append
 * nothing and emit nothing).
 */
export async function recordLegacyPostingLedger(
  tx: Writer,
  input: LegacyPostingInput,
): Promise<void> {
  if (input.fromOfficeId === input.toOfficeId) return;

  // Close the previous open substantive span the day before the new one begins,
  // then append the new open span (post_id NULL — no sanctioned post is known
  // on the legacy path).
  const closeAt = repo.dayBefore(input.effectiveDate);
  // A same-day or back-dated legacy transfer cannot be represented as a valid
  // ledger span (posting_ledger_dates_check). The ledger is supplementary here:
  // it must never roll back the legacy transfer it shadows, so skip (and log)
  // rather than throw.
  const openStart = await repo.findOpenLedgerSpanStart(tx, input.employeeId);
  if (openStart && closeAt < openStart) {
    log.warn(
      {
        employeeId: input.employeeId,
        effectiveDate: input.effectiveDate,
        openSpanStart: openStart,
      },
      "legacy transfer is not after the current ledger span; ledger span skipped",
    );
    return;
  }
  await repo.closeOpenLedgerSpan(tx, input.employeeId, closeAt);
  await repo.appendLegacyLedgerSpan(tx, {
    tenantId: input.tenantId,
    employeeId: input.employeeId,
    officeId: input.toOfficeId,
    effectiveFrom: input.effectiveDate,
    orderRef: input.orderRef,
    actorId: input.actorId,
  });

  // Standalone posting event gated by HRMS_POSTING_EVENTS_ENABLED (default off)
  // — same ratchet reasoning as apply.ts. The ledger span above is always
  // recorded when the ledger flag is on; the event only fires once a consumer
  // exists.
  if (!isPostingEventsEnabled()) return;

  const employee = await repo.findEmployee(tx, input.employeeId);
  await enqueue(tx as EnqueueTx, {
    topic: POSTING_CHANGED_TOPIC,
    eventType: POSTING_CHANGED_TOPIC,
    tenantId: input.tenantId,
    actorId: input.actorId,
    correlationId: input.correlationId || randomUUID(),
    payload: {
      employeeId: input.employeeId,
      tenantId: input.tenantId,
      fromOfficeId: input.fromOfficeId,
      toOfficeId: input.toOfficeId,
      station: employee?.station ?? "unknown",
      state: employee?.state ?? "unknown",
      cityClass: employee?.hraCityClass ?? "X",
      effectiveFrom: input.effectiveDate,
      orderNumber: input.orderRef ?? "legacy",
    },
  });
}
