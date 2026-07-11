/**
 * visitor-service: material-pass command publishers.
 *
 * Thin CQRS publishers (route → zod validate → publish → 202 pattern).
 *
 * `materialPassCreate` — publishes items declared at check-in (Requirement
 * 13.1). Consumer persists material_passes rows.
 *
 * `materialPassReconcile` — publishes an exit-reconciliation request
 * (Requirement 13.3). Consumer runs `reconcileOnExit` and
 * `handleUndeclaredItemOnExit` from domain.ts; if a discrepancy or
 * undeclared items are detected, the consumer emits
 * `securityIncidentCreated` via the outbox.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface MaterialPassCreateInput {
  passId: string;
  locationId: string;
  items: Array<{
    description: string;
    quantity: number;
    serialNumber?: string | null;
  }>;
}

/**
 * Publishes materialPassCreate command. The `id` returned is the
 * material-pass batch id (one per pass + entry event). Consumer inserts
 * one `material_passes` row per declared item.
 */
export async function materialPassCreate(ctx: RequestContext, input: MaterialPassCreateInput): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.materialPassCreate, {
    messageId: id,
    type: COMMANDS.materialPassCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      passId: input.passId,
      locationId: input.locationId,
      items: input.items,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export interface MaterialPassReconcileInput {
  passId: string;
  locationId: string;
  itemsPresentAtExit: Array<{
    description: string;
    quantity: number;
    serialNumber?: string | null;
  }>;
}

/**
 * Publishes materialPassReconcile command. Consumer loads the declared items
 * for the pass, runs domain reconciliation, flags discrepancy rows, and
 * outboxes `securityIncidentCreated` when discrepancy or undeclared items
 * are detected (Requirements 13.3, 13.4).
 */
export async function materialPassReconcile(ctx: RequestContext, input: MaterialPassReconcileInput): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.materialPassReconcile, {
    messageId: id,
    type: COMMANDS.materialPassReconcile,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      passId: input.passId,
      locationId: input.locationId,
      itemsPresentAtExit: input.itemsPresentAtExit,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
