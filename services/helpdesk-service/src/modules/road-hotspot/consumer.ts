/**
 * Road Hotspot (BRD 5.14 ROAD-004) — command consumers.
 *
 * POST /v1/helpdesk/road-hotspots (and link-ticket / plan-maintenance / resolve)
 * published helpdesk.road_hotspot.* commands that nothing consumed, so every
 * call returned 202 and persisted nothing. Each handler: markProcessed
 * (idempotent redelivery) + a status-guarded tenant-scoped write + an audit
 * event in ONE transaction; a command whose preconditions no longer hold is
 * audited as rejected rather than thrown.
 */
import type { Queue } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { tickets } from "../tickets/schema.js";
import * as repo from "./repo.js";
import { calculateRiskScore, type RoadCategory } from "./domain.js";
import type { RoadHotspotLocation } from "./schema.js";

const AUDIT = "audit.event.record";

type Msg = { tenantId: string; actorId: string; correlationId: string };
type Tx = Parameters<typeof enqueue>[0];

async function audit(tx: Tx, msg: Msg, action: string, resourceType: string, resourceId: string, outcome: string) {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "helpdesk", action, resourceType, resourceId, outcome },
  });
}

/** Hotspot code derived from the command id (stable across redelivery/restarts). */
export function hotspotCodeFor(id: string, now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `RH-${y}${m}${d}-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

type CreatePayload = {
  id: string; tenantId: string; location: RoadHotspotLocation; category: string;
  complaintCount?: number; lastComplaintAt?: string | null; maintenancePlanRef?: string | null;
};
type LinkPayload = { id: string; tenantId: string; hotspotId: string; ticketId: string };
type PlanPayload = { tenantId: string; hotspotId: string; maintenancePlanRef: string };
type ResolvePayload = { tenantId: string; hotspotId: string };

export function registerRoadHotspotConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe<CreatePayload>(COMMANDS.roadHotspotCreate, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const count = p.complaintCount ?? 0;
      const last = p.lastComplaintAt ? new Date(p.lastComplaintAt) : null;
      await repo.insertHotspot(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        hotspotCode: hotspotCodeFor(p.id),
        location: p.location,
        category: p.category,
        complaintCount: count,
        lastComplaintAt: last,
        riskScore: calculateRiskScore(count, p.category as RoadCategory, last),
        status: "identified",
        maintenancePlanRef: p.maintenancePlanRef ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await audit(tx as Tx, msg, "hotspot_create", "road_hotspot", p.id, "success");
    });
  });

  queue.subscribe<LinkPayload>(COMMANDS.roadHotspotLinkTicket, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const hotspot = await repo.findHotspotTx(tx, p.hotspotId, msg.tenantId);
      if (!hotspot || hotspot.status === "resolved") {
        await audit(tx as Tx, msg, "hotspot_link_ticket", "road_hotspot", p.hotspotId, hotspot ? "rejected_hotspot_resolved" : "rejected_not_found");
        return;
      }
      // The ticket must exist in this tenant (link rows carry no FK).
      const ticket = await (tx as unknown as typeof db).select({ id: tickets.id }).from(tickets)
        .where(and(eq(tickets.id, p.ticketId), eq(tickets.tenantId, msg.tenantId))).limit(1);
      if (ticket.length === 0) {
        await audit(tx as Tx, msg, "hotspot_link_ticket", "road_hotspot", p.hotspotId, "rejected_ticket_not_found");
        return;
      }
      if (await repo.findLinkTx(tx, msg.tenantId, p.hotspotId, p.ticketId)) {
        await audit(tx as Tx, msg, "hotspot_link_ticket", "road_hotspot", p.hotspotId, "noop_already_linked");
        return;
      }
      await repo.insertLink(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        hotspotId: p.hotspotId,
        ticketId: p.ticketId,
        linkedBy: msg.actorId,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await audit(tx as Tx, msg, "hotspot_link_ticket", "road_hotspot", p.hotspotId, "success");
    });
  });

  queue.subscribe<PlanPayload>(COMMANDS.roadHotspotPlanMaintenance, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.transitionHotspot(tx, p.hotspotId, msg.tenantId,
        ["identified", "under_review", "maintenance_planned"], {
          status: "maintenance_planned", maintenancePlanRef: p.maintenancePlanRef, updatedBy: msg.actorId,
        });
      await audit(tx as Tx, msg, "hotspot_plan_maintenance", "road_hotspot", p.hotspotId, row ? "success" : "rejected_invalid_status");
    });
  });

  queue.subscribe<ResolvePayload>(COMMANDS.roadHotspotResolve, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.transitionHotspot(tx, p.hotspotId, msg.tenantId, ["work_in_progress"], {
        status: "resolved", resolvedAt: new Date(), updatedBy: msg.actorId,
      });
      await audit(tx as Tx, msg, "hotspot_resolve", "road_hotspot", p.hotspotId, row ? "success" : "rejected_not_in_progress");
    });
  });
}
