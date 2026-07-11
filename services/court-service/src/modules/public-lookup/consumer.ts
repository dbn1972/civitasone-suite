import { type CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

type PublishEstablishmentPayload = {
  id: string;
  tenantId: string;
  establishmentCode: string;
  cnrPrefix: string;
  courtName: string;
  publicSlug: string;
};

export function registerPublicLookupConsumers(
  register: <T>(topic: string, handler: (msg: CommandEnvelope<T>) => Promise<void>) => void,
): void {
  // Publish a public-directory establishment (§ public-lookup).
  // NOTE: public_establishments has NO RLS, so the tenant GUC is irrelevant to the
  // write; the handler shape (markProcessed → write → enqueue event → audit) matches
  // every other consumer for consistency.
  register<PublishEstablishmentPayload>(COMMANDS.publishEstablishment, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      await repo.insertEstablishment(tx, {
        id: p.id,
        tenantId: p.tenantId,
        establishmentCode: p.establishmentCode,
        cnrPrefix: p.cnrPrefix,
        courtName: p.courtName,
        publicSlug: p.publicSlug,
        active: true,
        createdBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.establishmentPublished,
        eventType: EVENTS.establishmentPublished,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          establishmentId: p.id,
          establishmentCode: p.establishmentCode,
          cnrPrefix: p.cnrPrefix,
          publicSlug: p.publicSlug,
        },
      });

      await audit(tx, msg, "publish", "court_public_establishment", p.id);
    });
  });
}

async function audit(
  tx: Parameters<typeof markProcessed>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record",
    eventType: "audit.event.record",
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "court", action, resourceType, resourceId, outcome: "success" },
  });
}
