import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "hrms.orgchart.consumer" });
const AUDIT = "audit.event.record";

export function registerOrgchartConsumers(queue: Queue): void {
  queue.subscribe("hrms.orgchart.refresh", async (msg) => {
    const p = msg.payload as { tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.orgchart.refreshed",
        eventType: "hrms.orgchart.refreshed",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { tenantId: p.tenantId },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "orgchart_refresh", resourceType: "orgchart", resourceId: msg.messageId, outcome: "success" },
      });
    });
    // GAP-HR-ORG-CHART-01: this used to invalidate resource "orgchart" while
    // getOrgChart's cached tree is keyed under resource "org_chart"
    // (orgchart/queries.ts's cache.listOrLoad(tenantId, "org_chart", "tree",
    // ...)) -- the mismatched name made this a silent no-op that never
    // actually cleared the cached tree.
    await cache.invalidateResource(msg.tenantId, "org_chart");
    log.info({ id: msg.messageId }, "Processed orgchart.refresh");
  });
}
