/**
 * Role / desk fan-out (notify-roles). A send addressed to a desk label (role-recipients.ts) is expanded
 * here into ONE send command per distinct real user, each handled by the ordinary send consumer, so
 * every user's own channel preferences, suppression, DND and CRM consent are applied individually.
 *
 * Exactly-once per (message, user): the parent's markProcessed, the per-user child commands and the
 * audit row commit in ONE transaction, so a redelivered parent finds itself processed and enqueues
 * nothing, and a crash before commit enqueues nothing at all.
 *
 * Each child is addressed to the USER's own tenant (a platform operator is not in the tenant whose event
 * raised the notice), so its delivery row, preferences and consent are read under that tenant.
 */
import { pino } from "pino";
import type { CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { MAX_FANOUT, type DeskDefinition } from "./role-recipients.js";
import { fetchRoleHolders, type RoleHolderLookup } from "./role-holders-client.js";

const log = pino({ name: "notification:role-fanout" });
const AUDIT_TOPIC = "audit.event.record";

let lookup: RoleHolderLookup = fetchRoleHolders;
/** Test seam: production always uses the identity-service client. */
export function setRoleHolderLookupForTests(fn: RoleHolderLookup): void { lookup = fn; }
export function resetRoleHolderLookup(): void { lookup = fetchRoleHolders; }

type Tx = Parameters<typeof enqueue>[0];

export async function fanOutToDesk(
  msg: CommandEnvelope<Record<string, unknown>>,
  desk: string,
  def: DeskDefinition,
): Promise<void> {
  // The lookup is an outbound HTTP call, so it runs BEFORE the transaction opens (no pooled
  // connection is pinned for a remote timeout). A failure throws: the queue retries; it is never
  // read as "nobody holds this role".
  const { holders, truncated } = await lookup({
    scope: def.scope, roles: def.roles, tenantId: msg.tenantId, correlationId: msg.correlationId, max: MAX_FANOUT,
  });
  const users = new Map(holders.map((h) => [h.userId, h]));

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    for (const h of users.values()) {
      await enqueue(tx as Tx, {
        topic: COMMANDS.sendNotification, eventType: COMMANDS.sendNotification,
        tenantId: h.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        // The desk label is replaced by the real user; everything else (template, variables, event
        // type, category) is carried through so the per-user send is the same notice.
        payload: { ...msg.payload, recipient: h.userId, recipientId: h.userId },
      });
    }
    await enqueue(tx as Tx, {
      topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        service: "notification", action: "role_fanout", resourceType: "desk_notice", resourceId: msg.messageId,
        outcome: users.size === 0 ? "no_recipients" : truncated ? "truncated" : "success",
        desk, scope: def.scope, roles: [...def.roles], recipientCount: users.size, truncated, cap: MAX_FANOUT,
      },
    });
  });

  if (users.size === 0) log.warn({ desk, scope: def.scope, tenantId: msg.tenantId, messageId: msg.messageId }, "desk resolved to no active users");
  else if (truncated) log.warn({ desk, cap: MAX_FANOUT, tenantId: msg.tenantId, messageId: msg.messageId }, "desk fan-out truncated at the hard cap");
}
