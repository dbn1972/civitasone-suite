import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { generateHotspotCode, canTransition, calculateRiskScore } from "./domain.js";
import type { RoadHotspotLocation } from "./schema.js";
import type { RoadCategory } from "./domain.js";

const log = pino({ name: "helpdesk.road_hotspot.consumer" });
const AUDIT = "audit.event.record";

type Msg = { tenantId: string; actorId: string; correlationId: string; messageId: string };
type Tx = Parameters<typeof enqueue>[0];

function audit(tx: Tx, msg: Msg, action: string, resourceId: string, outcome = "success"): Promise<unknown> {
  return enqueue(tx, {
    topic: AUDIT,
    eventType: AUDIT,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "helpdesk", action, resourceType: "road_hotspot", resourceId, outcome },
  });
}

function event(tx: Tx, msg: Msg, eventType: string, payload: Record<string, unknown>): Promise<unknown> {
  return enqueue(tx, {
    topic: eventType,
    eventType,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload,
  });
}

export function registerRoadHotspotConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.roadHotspotCreate, async (msg) => {
    const p = msg.payload as Record<string, unknown> & { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const hotspotCode = generateHotspotCode();
      const category = p.category as RoadCategory;
      const complaintCount = (p.complaintCount as number) ?? 0;
      const lastComplaintAt = p.lastComplaintAt ? new Date(p.lastComplaintAt as string) : null;
      const riskScore = calculateRiskScore(complaintCount, category, lastComplaintAt);
      try {
        await repo.insertHotspot(tx as repo.Writer, {
          id: p.id,
          tenantId: p.tenantId,
          hotspotCode,
          location: p.location as RoadHotspotLocation,
          category,
          complaintCount,
          lastComplaintAt,
          riskScore,
          status: "identified",
          maintenancePlanRef: (p.maintenancePlanRef as string | null) ?? null,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
        await event(tx as Tx, msg, EVENTS.roadHotspotCreated, {
          hotspotId: p.id,
          hotspotCode,
          category,
          riskScore,
          location: p.location,
        });
        await audit(tx, msg, "create_road_hotspot", p.id);
      } catch (err) {
        if ((err as { code?: string }).code === "23505") {
          await audit(tx, msg, "create_road_hotspot", p.id, "rejected_duplicate");
        } else {
          throw err;
        }
      }
    });
    log.info({ id: p.id }, "road hotspot created");
  });

  queue.subscribe(COMMANDS.roadHotspotLinkTicket, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; hotspotId: string; ticketId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const hotspot = await repo.findHotspot(p.hotspotId, p.tenantId);
      if (!hotspot) return;
      await repo.insertLink(tx as repo.Writer, {
        id: p.id,
        tenantId: p.tenantId,
        hotspotId: p.hotspotId,
        ticketId: p.ticketId,
        linkedBy: msg.actorId,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      // Update complaint count and recalculate risk score
      const newCount = hotspot.complaintCount + 1;
      const now = new Date();
      const riskScore = calculateRiskScore(
        newCount,
        hotspot.category as RoadCategory,
        now,
      );
      await repo.updateHotspot(tx as repo.Writer, p.hotspotId, p.tenantId, {
        complaintCount: newCount,
        lastComplaintAt: now,
        riskScore,
        updatedBy: msg.actorId,
      });
      await audit(tx as Tx, msg, "link_ticket_to_hotspot", p.id);
    });
  });

  queue.subscribe(COMMANDS.roadHotspotPlanMaintenance, async (msg) => {
    const p = msg.payload as { tenantId: string; hotspotId: string; maintenancePlanRef: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const hotspot = await repo.findHotspot(p.hotspotId, p.tenantId);
      if (!hotspot) return;
      // Transition: identified -> under_review -> maintenance_planned
      // Allow planning from under_review
      if (!canTransition(hotspot.status as Parameters<typeof canTransition>[0], "maintenance_planned") &&
          hotspot.status !== "identified") return;

      // If identified, transition through under_review first
      let targetStatus: string = "maintenance_planned";
      if (hotspot.status === "identified") {
        // auto-advance through under_review to maintenance_planned
        targetStatus = "maintenance_planned";
      }

      await repo.updateHotspot(tx as repo.Writer, p.hotspotId, p.tenantId, {
        status: targetStatus,
        maintenancePlanRef: p.maintenancePlanRef,
        updatedBy: msg.actorId,
      });
      await audit(tx as Tx, msg, "plan_maintenance_hotspot", p.hotspotId);
    });
  });

  queue.subscribe(COMMANDS.roadHotspotResolve, async (msg) => {
    const p = msg.payload as { tenantId: string; hotspotId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const hotspot = await repo.findHotspot(p.hotspotId, p.tenantId);
      if (!hotspot) return;
      if (!canTransition(hotspot.status as Parameters<typeof canTransition>[0], "resolved")) return;
      const now = new Date();
      await repo.updateHotspot(tx as repo.Writer, p.hotspotId, p.tenantId, {
        status: "resolved",
        resolvedAt: now,
        updatedBy: msg.actorId,
      });
      await event(tx as Tx, msg, EVENTS.roadHotspotResolved, {
        hotspotId: p.hotspotId,
        hotspotCode: hotspot.hotspotCode,
      });
      await audit(tx as Tx, msg, "resolve_road_hotspot", p.hotspotId);
    });
  });
}
