import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "location-road-network-consumer" });
const AUDIT = "audit.event.record";

export function registerRoadNetworkConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.roadSegmentCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; name: string; roadClass: string;
      fromNode: string; toNode: string; coordinates: [number, number][];
    };
    try {
      let ok = false;
      await db.transaction(async (tx) => { ok = await markProcessed(tx, msg.messageId); });
      if (!ok) return;
      await repo.createSegment(p.tenantId, msg.actorId, {
        id: p.id, name: p.name, roadClass: p.roadClass as never,
        fromNode: p.fromNode, toNode: p.toNode, coordinates: p.coordinates,
      });
      await db.transaction(async (tx) => {
        await enqueue(tx, {
          topic: AUDIT, eventType: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "location", action: "road_segment_create", resourceType: "road_segment", resourceId: p.id, outcome: "success" },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "roadSegmentCreate failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.roadSegmentDelete, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    try {
      let ok = false;
      await db.transaction(async (tx) => { ok = await markProcessed(tx, msg.messageId); });
      if (!ok) return;
      await repo.deleteSegment(p.id, p.tenantId);
      await db.transaction(async (tx) => {
        await enqueue(tx, {
          topic: AUDIT, eventType: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "location", action: "road_segment_delete", resourceType: "road_segment", resourceId: p.id, outcome: "success" },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "roadSegmentDelete failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.roadNetworkCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; name: string; description?: string; segmentIds: string[];
    };
    try {
      let ok = false;
      await db.transaction(async (tx) => { ok = await markProcessed(tx, msg.messageId); });
      if (!ok) return;
      await repo.createNetwork(p.tenantId, msg.actorId, {
        id: p.id, name: p.name, description: p.description, segmentIds: p.segmentIds,
      });
      await db.transaction(async (tx) => {
        await enqueue(tx, {
          topic: AUDIT, eventType: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "location", action: "road_network_create", resourceType: "road_network", resourceId: p.id, outcome: "success" },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "roadNetworkCreate failed");
      throw err;
    }
  });
}
