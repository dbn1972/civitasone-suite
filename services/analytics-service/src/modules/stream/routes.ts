/**
 * Real-time dashboard push via Server-Sent Events (SSE).
 *
 * GET /v1/analytics/stream — SSE endpoint that emits dashboard update events
 * when fact_events are ingested. Tenant-scoped: only emits events for the
 * authenticated tenant's data.
 *
 * Protocol:
 *   Content-Type: text/event-stream
 *   Cache-Control: no-cache
 *   Connection: keep-alive
 *   Heartbeat: every 30s (:ping comment)
 *
 * Events:
 *   event: dashboard_update
 *   data: { tenantId, metric, value, timestamp }
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";
import { EventEmitter } from "node:events";

const ANALYTICS_ROLES = ["analytics_user", "analytics_admin", "crm_admin", "super_admin", "tenant_admin"];

/**
 * In-process event bus for dashboard updates. In production this would be
 * backed by Redis pub/sub or similar, but for the SSE contract the in-process
 * emitter is sufficient — the consumer that ingests fact_events calls
 * `emitDashboardUpdate()` and all connected SSE clients for that tenant receive it.
 */
export const dashboardBus = new EventEmitter();
dashboardBus.setMaxListeners(200);

export interface DashboardUpdateEvent {
  tenantId: string;
  metric: string;
  value: number;
  timestamp: string;
}

/** Call this from fact ingestion consumers to push updates to connected clients. */
export function emitDashboardUpdate(event: DashboardUpdateEvent): void {
  dashboardBus.emit(`update:${event.tenantId}`, event);
}

export async function streamRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/analytics/stream", { config: { public: false } }, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ANALYTICS_ROLES);

    const tenantId = ctx.tenantId;

    // Set SSE headers — must NOT buffer
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // Send initial connection event
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ tenantId, connectedAt: new Date().toISOString() })}\n\n`);

    // Listener for this tenant's updates
    const onUpdate = (event: DashboardUpdateEvent): void => {
      reply.raw.write(`event: dashboard_update\ndata: ${JSON.stringify(event)}\n\n`);
    };

    dashboardBus.on(`update:${tenantId}`, onUpdate);

    // Heartbeat every 30s to keep connection alive
    const heartbeat = setInterval(() => {
      reply.raw.write(`:ping ${Date.now()}\n\n`);
    }, 30_000);

    // Cleanup on client disconnect
    req.raw.on("close", () => {
      clearInterval(heartbeat);
      dashboardBus.off(`update:${tenantId}`, onUpdate);
    });

    // Prevent Fastify from closing the response — we manage it manually
    await reply.hijack();
  });
}
