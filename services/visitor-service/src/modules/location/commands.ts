/**
 * visitor-service: location / area command publishers.
 *
 * Locations and areas were previously written synchronously straight to
 * Postgres from routes.ts (see the historical comment in ./repo.ts). Task
 * Q-95.1 moves the write path onto the same route -> zod validate -> publish
 * -> 202 CQRS convention used by every other mutating module in this
 * service (mirrors modules/blacklist/commands.ts and
 * modules/config-registry/commands.ts in shape).
 *
 * `commands.ts` mints the row's `id` (uuid) BEFORE publishing and returns it
 * to the caller as the 202 Accepted `id` — the consumer (./consumer.ts) MUST
 * insert with that exact `id` so a redelivery is an idempotent no-op and the
 * id returned to the client at request time matches the eventually-persisted
 * row.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { BusinessHours } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface LocationCreateInput {
  name: string;
  address?: string | undefined;
  businessHours: BusinessHours;
  capacity?: number | undefined;
  capacityThreshold?: number | undefined;
  active?: boolean | undefined;
}

/** Requirement: admin-managed reference data — creates a new location. */
export async function locationCreate(ctx: RequestContext, input: LocationCreateInput): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.locationCreate, {
    messageId: id,
    type: COMMANDS.locationCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      name: input.name,
      address: input.address ?? null,
      businessHours: input.businessHours,
      ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
      ...(input.capacityThreshold !== undefined ? { capacityThreshold: input.capacityThreshold } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      createdBy: ctx.actorId,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export interface AreaCreateInput {
  name: string;
  securityLevel?: number | undefined;
  authorizedApprovers?: string[] | undefined;
  escortRequired?: boolean | undefined;
  active?: boolean | undefined;
}

/** Requirement: admin-managed reference data — creates a new area under a location. */
export async function areaCreate(ctx: RequestContext, locationId: string, input: AreaCreateInput): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.areaCreate, {
    messageId: id,
    type: COMMANDS.areaCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      locationId,
      name: input.name,
      ...(input.securityLevel !== undefined ? { securityLevel: input.securityLevel } : {}),
      ...(input.authorizedApprovers !== undefined ? { authorizedApprovers: input.authorizedApprovers } : {}),
      ...(input.escortRequired !== undefined ? { escortRequired: input.escortRequired } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      createdBy: ctx.actorId,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
