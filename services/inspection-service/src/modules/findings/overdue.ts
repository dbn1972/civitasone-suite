/**
 * inspection-service: findings — overdue transition used by the hourly sweeper (worker.ts).
 *
 * Kept in its own module (worker.ts starts consumers on import) so the guarded transition and its outbox
 * events can be exercised against a real database.
 */
import { SYSTEM_ACTOR_ID } from "@civitasone/outbox";
import { enqueue as outboxEnqueue } from "../../shared/outbox.js";
import type { Db } from "../../shared/db.js";
import { EVENTS } from "../../topics.js";
import { transitionFindingStateIf } from "./repo.js";
import type { FindingRow } from "./schema.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Move a finding notice_issued -> overdue and emit the escalation events, atomically in `tx`.
 *
 * The sweeper reads candidates outside this transaction; a finding closed/verified in between must NOT be
 * overwritten with `overdue` nor trigger an escalation. The UPDATE is guarded on the expected state and the
 * events are only enqueued when it matched. Returns false when the transition was skipped (CLOS3-S5-13).
 */
export async function transitionFindingOverdue(
  tx: Tx,
  finding: Pick<FindingRow, "id" | "findingNumber" | "inspectionId">,
  tenantId: string,
): Promise<boolean> {
  const updated = await transitionFindingStateIf(tx, finding.id, tenantId, "notice_issued", "overdue", SYSTEM_ACTOR_ID);
  if (!updated) return false;

  // Emit overdue event via outbox for notification escalation
  await outboxEnqueue(tx, {
    topic: EVENTS.findingOverdue,
    eventType: EVENTS.findingOverdue,
    tenantId,
    actorId: SYSTEM_ACTOR_ID,
    correlationId: `overdue-check-${finding.id}`,
    payload: {
      findingId: finding.id,
      findingNumber: finding.findingNumber,
      inspectionId: finding.inspectionId,
      entityId: finding.inspectionId,
      dueDate: "past",
    },
  });

  // Notification escalation event
  await outboxEnqueue(tx, {
    topic: "notification.send",
    eventType: "notification.send",
    tenantId,
    actorId: SYSTEM_ACTOR_ID,
    correlationId: `overdue-notif-${finding.id}`,
    payload: {
      type: "finding.overdue_escalation",
      data: {
        findingId: finding.id,
        findingNumber: finding.findingNumber,
        inspectionId: finding.inspectionId,
      },
    },
  });
  return true;
}
