/**
 * CM-001 addresses consumer. Idempotent (markProcessed), tenant-scoped, one-primary
 * enforced on write: whenever a row is created/updated as primary, the previous
 * primary for that owner is demoted first (the partial unique index is the backstop).
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { sql, type SQL } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const log = pino({ name: "crm-addresses-consumer" });
const AUDIT = "audit.event.record";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface CreatePayload {
  id: string; tenantId: string; ownerType: string; ownerId: string; addressType: string;
  line1: string; line2: string | null; city: string | null; state: string | null;
  pincode: string | null; country: string; isPrimary: boolean;
}

/** Demote the current primary for an owner so a new primary is unique. */
async function demoteOthers(tx: Tx, tenantId: string, ownerType: string, ownerId: string, exceptId: string, actorId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE crm.addresses SET is_primary = false, updated_at = now(), updated_by = ${actorId}
    WHERE tenant_id = ${tenantId} AND owner_type = ${ownerType} AND owner_id = ${ownerId}
      AND is_primary = true AND id <> ${exceptId}
  `);
}

async function audit(tx: Tx, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, id: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "crm", action, resourceType: "address", resourceId: id, outcome: "success" },
  });
}

export function registerAddressConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.createAddress, async (msg) => {
    const p = msg.payload as CreatePayload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        if (p.isPrimary) await demoteOthers(tx, p.tenantId, p.ownerType, p.ownerId, p.id, msg.actorId);
        await tx.execute(sql`
          INSERT INTO crm.addresses
            (id, tenant_id, owner_type, owner_id, address_type, line1, line2, city, state, pincode, country, is_primary, created_by, updated_by)
          VALUES
            (${p.id}, ${p.tenantId}, ${p.ownerType}, ${p.ownerId}, ${p.addressType}, ${p.line1}, ${p.line2},
             ${p.city}, ${p.state}, ${p.pincode}, ${p.country}, ${p.isPrimary}, ${msg.actorId}, ${msg.actorId})
        `);
        await enqueue(tx, {
          topic: EVENTS.addressCreated, eventType: EVENTS.addressCreated,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { addressId: p.id, ownerType: p.ownerType, ownerId: p.ownerId },
        });
        await audit(tx, msg, "address_create", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "createAddress failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.updateAddress, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; changed: Record<string, unknown> };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const c = p.changed ?? {};
        const sets: SQL[] = [];
        if (c.addressType !== undefined) sets.push(sql`address_type = ${c.addressType as string}`);
        if (c.line1 !== undefined) sets.push(sql`line1 = ${c.line1 as string}`);
        if (c.line2 !== undefined) sets.push(sql`line2 = ${(c.line2 ?? null) as string | null}`);
        if (c.city !== undefined) sets.push(sql`city = ${(c.city ?? null) as string | null}`);
        if (c.state !== undefined) sets.push(sql`state = ${(c.state ?? null) as string | null}`);
        if (c.pincode !== undefined) sets.push(sql`pincode = ${(c.pincode ?? null) as string | null}`);
        if (c.country !== undefined) sets.push(sql`country = ${c.country as string}`);
        if (c.isPrimary !== undefined) sets.push(sql`is_primary = ${c.isPrimary as boolean}`);
        if (sets.length === 0) return;

        // If promoting to primary, demote the owner's current primary first.
        if (c.isPrimary === true) {
          const owner = (await tx.execute(sql`
            SELECT owner_type AS "ownerType", owner_id AS "ownerId" FROM crm.addresses
            WHERE id = ${p.id} AND tenant_id = ${p.tenantId}
          `)) as unknown as Array<{ ownerType: string; ownerId: string }>;
          if (owner[0]) await demoteOthers(tx, p.tenantId, owner[0].ownerType, owner[0].ownerId, p.id, msg.actorId);
        }

        sets.push(sql`updated_at = now()`);
        sets.push(sql`updated_by = ${msg.actorId}`);
        sets.push(sql`version = version + 1`);
        await tx.execute(sql`
          UPDATE crm.addresses SET ${sql.join(sets, sql`, `)}
          WHERE id = ${p.id} AND tenant_id = ${p.tenantId}
        `);
        await enqueue(tx, {
          topic: EVENTS.addressUpdated, eventType: EVENTS.addressUpdated,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { addressId: p.id },
        });
        await audit(tx, msg, "address_update", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "updateAddress failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.deleteAddress, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`DELETE FROM crm.addresses WHERE id = ${p.id} AND tenant_id = ${p.tenantId}`);
        await enqueue(tx, {
          topic: EVENTS.addressDeleted, eventType: EVENTS.addressDeleted,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { addressId: p.id },
        });
        await audit(tx, msg, "address_delete", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "deleteAddress failed");
      throw err;
    }
  });
}
