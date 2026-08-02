/**
 * visitor-service: location / area consumer.
 *
 * Handles `COMMANDS.locationCreate` / `COMMANDS.areaCreate` (CQRS write path):
 *   markProcessed(tx, msg.messageId) -> insert `visitor.locations` /
 *   `visitor.areas` row (using the id minted by commands.ts, so a
 *   redelivery is an idempotent no-op) -> outbox `locationCreated` /
 *   `areaCreated` event -> invalidate the read cache after commit.
 *
 * Task Q-95.1: locations/areas were previously written synchronously
 * straight to Postgres from routes.ts (see the historical comment this
 * replaced in ./repo.ts). This consumer follows the exact shape of
 * modules/blacklist/consumer.ts and modules/config-registry/consumer.ts.
 */
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { locations, areas } from "./schema.js";
import type { BusinessHours } from "./schema.js";

const RESOURCE = "location";

export interface LocationCreatePayload {
  id: string;
  tenantId: string;
  name: string;
  address: string | null;
  businessHours: BusinessHours;
  capacity?: number;
  capacityThreshold?: number;
  active?: boolean;
  createdBy: string;
}

export interface AreaCreatePayload {
  id: string;
  tenantId: string;
  locationId: string;
  name: string;
  securityLevel?: number;
  authorizedApprovers?: string[];
  escortRequired?: boolean;
  active?: boolean;
  createdBy: string;
}

export function registerLocationConsumers(queue: Queue): void {
  // ─── locationCreate ────────────────────────────────────────────────────
  queue.subscribe<LocationCreatePayload>(COMMANDS.locationCreate, async (msg) => {
    const p = msg.payload;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent replay

      const now = new Date();
      await tx.insert(locations).values({
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        address: p.address ?? null,
        businessHours: p.businessHours,
        ...(p.capacity !== undefined ? { capacity: p.capacity } : {}),
        ...(p.capacityThreshold !== undefined ? { capacityThreshold: p.capacityThreshold } : {}),
        ...(p.active !== undefined ? { active: p.active } : {}),
        createdAt: now,
        updatedAt: now,
        createdBy: p.createdBy,
        updatedBy: p.createdBy,
      });

      await enqueue(tx, {
        topic: EVENTS.locationCreated,
        eventType: EVENTS.locationCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, name: p.name },
      });

      await cache.invalidateAfterCommit(tx, cache.makeKey(p.tenantId, RESOURCE, p.id));
    });
  });

  // ─── areaCreate ────────────────────────────────────────────────────────
  queue.subscribe<AreaCreatePayload>(COMMANDS.areaCreate, async (msg) => {
    const p = msg.payload;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent replay

      const now = new Date();
      await tx.insert(areas).values({
        id: p.id,
        tenantId: p.tenantId,
        locationId: p.locationId,
        name: p.name,
        ...(p.securityLevel !== undefined ? { securityLevel: p.securityLevel } : {}),
        ...(p.authorizedApprovers !== undefined ? { authorizedApprovers: p.authorizedApprovers } : {}),
        ...(p.escortRequired !== undefined ? { escortRequired: p.escortRequired } : {}),
        ...(p.active !== undefined ? { active: p.active } : {}),
        createdAt: now,
        updatedAt: now,
        createdBy: p.createdBy,
        updatedBy: p.createdBy,
      });

      await enqueue(tx, {
        topic: EVENTS.areaCreated,
        eventType: EVENTS.areaCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, locationId: p.locationId, name: p.name },
      });

      // Areas may be embedded in a future location-detail read — invalidate
      // the parent location's cache entry too, matching the previous
      // repo.ts behavior.
      await cache.invalidateAfterCommit(tx, cache.makeKey(p.tenantId, RESOURCE, p.locationId));
    });
  });
}
