/**
 * INT-04: Inbox Correlations repo — links conversation threads to helpdesk tickets.
 *
 * Closes an orphan loop: `notification.inbox.correlate` was published by
 * correlation-routes.ts with nothing consuming it, so a POST to
 * /v1/notification/inbox/:conversationId/correlate returned 202 and the GET
 * sibling on the same route file could never find a row (there is no INSERT
 * path anywhere). This repo function is used by the consumer in consumer.ts.
 */
import type { Db } from "../../shared/db.js";
import { inboxCorrelations, type InboxCorrelationInsert } from "./correlation-schema.js";

type Writer = Parameters<Db["transaction"]>[0] extends (tx: infer T) => unknown ? T : never;

/**
 * Idempotent on (tenant_id, conversation_id) — a repeated/edited correlation
 * for the same conversation updates the linked ticket rather than violating
 * the unique index created in migration 0025.
 */
export async function upsertCorrelation(
  tx: Writer,
  row: InboxCorrelationInsert,
): Promise<void> {
  await tx
    .insert(inboxCorrelations)
    .values(row)
    .onConflictDoUpdate({
      target: [inboxCorrelations.tenantId, inboxCorrelations.conversationId],
      set: {
        ticketId: row.ticketId,
      },
    });
}
