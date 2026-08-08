import type { Queue } from "@civitasone/queue";
import { getTableName } from "drizzle-orm";
import { parseMinor } from "@civitasone/schemas";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { masterTableByPrefix, masterMoneyFieldsByPrefix } from "./registry.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * Master-create consumer (fixes the CRITICAL CQRS bug where masters/routes.ts
 * used to publish to COMMANDS.proposalCreate).
 *
 * Resolves payload.masterType (the registry prefix, e.g. "sr-items") to its
 * table via masterTableByPrefix — the SAME registry masters/routes.ts uses to
 * publish — so a master type can never be routed to the wrong table.
 */
export function registerMasterConsumers(q: Queue): void {
  q.subscribe(COMMANDS.masterCreate, async (msg) => {
    const p = msg.payload as Record<string, unknown>;
    const { id, masterType, ...body } = p;
    const table = masterTableByPrefix[masterType as string];

    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return; // idempotent skip
      if (!table) return; // reject: unknown master type — never persist to the wrong table

      const values: Record<string, unknown> = { id, tenantId: msg.tenantId, ...body };
      for (const field of masterMoneyFieldsByPrefix[masterType as string] ?? []) {
        if (values[field] !== undefined && values[field] !== null) {
          values[field] = parseMinor(values[field] as string | number);
        }
      }

      // Insert target varies by masterType (union of 17 distinct table shapes);
      // the columns are validated upstream by the per-type zod schema in registry.ts.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx.insert(table) as any).values(values);

      await enqueue(tx, {
        topic: EVENTS.masterCreated,
        eventType: EVENTS.masterCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id, masterType },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "create", resourceType: "master", resourceId: msg.messageId, outcome: "success" } });
    });

    if (table) {
      // getTableName (not table._.name — that internal accessor is undefined
      // on this drizzle-orm version) mirrors the resource repo.ts caches under.
      await cache.invalidateResource(msg.tenantId, `master:${getTableName(table)}`);
    }
  });
}
