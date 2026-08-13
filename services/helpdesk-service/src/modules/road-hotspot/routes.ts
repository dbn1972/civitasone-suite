/**
 * Road Hotspot (BRD 5.14 ROAD-004) — HTTP routes (CQRS: mutations return 202 Accepted).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listQuerySchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { ROAD_CATEGORIES, canTransition } from "./domain.js";
import type { HotspotRow, HotspotLinkRow } from "./schema.js";

const HELPDESK_ROLES = ["helpdesk_user", "helpdesk_agent", "helpdesk_admin", "super_admin", "admin"];

const locationSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  ward: z.string(),
  zone: z.string(),
  road_name: z.string(),
});

const createHotspotBody = z.object({
  location: locationSchema,
  category: z.enum(ROAD_CATEGORIES as [string, ...string[]]),
  complaintCount: z.number().int().min(0).optional(),
  lastComplaintAt: z.string().datetime().optional(),
  maintenancePlanRef: z.string().optional(),
});

const linkTicketBody = z.object({
  ticketId: z.string().uuid(),
});

const planMaintenanceBody = z.object({
  maintenancePlanRef: z.string().min(1),
});

const idParam = z.object({ id: z.string().uuid() });

function hotspotView(h: HotspotRow) {
  return {
    id: h.id,
    hotspotCode: h.hotspotCode,
    location: h.location,
    category: h.category,
    complaintCount: h.complaintCount,
    lastComplaintAt: h.lastComplaintAt,
    riskScore: h.riskScore,
    status: h.status,
    maintenancePlanRef: h.maintenancePlanRef,
    resolvedAt: h.resolvedAt,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
  };
}

function linkView(l: HotspotLinkRow) {
  return {
    id: l.id,
    hotspotId: l.hotspotId,
    ticketId: l.ticketId,
    linkedAt: l.linkedAt,
    linkedBy: l.linkedBy,
  };
}

export async function roadHotspotRoutes(app: FastifyInstance): Promise<void> {
  // ── Hotspots ──────────────────────────────────────────────────────────────

  app.get("/v1/helpdesk/road-hotspots", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const q = listQuerySchema.parse(req.query);
    const rq = req.query as Record<string, unknown>;
    const status = typeof rq.status === "string" ? String(rq.status) : undefined;
    const category = typeof rq.category === "string" ? String(rq.category) : undefined;
    const rows = await repo.listHotspots(ctx.tenantId, { status, category, limit: q.limit, offset: q.offset });
    return reply.send({
      data: rows.map(hotspotView),
      pagination: { hasMore: rows.length === q.limit, pageSize: q.limit },
    });
  });

  app.get("/v1/helpdesk/road-hotspots/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { id } = idParam.parse(req.params);
    const hotspot = await repo.findHotspot(id, ctx.tenantId);
    if (!hotspot) throw new HttpError(404, "NOT_FOUND", "hotspot not found");
    return reply.send({ data: hotspotView(hotspot) });
  });

  app.get("/v1/helpdesk/road-hotspots/:id/linked-tickets", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { id } = idParam.parse(req.params);
    const hotspot = await repo.findHotspot(id, ctx.tenantId);
    if (!hotspot) throw new HttpError(404, "NOT_FOUND", "hotspot not found");
    const links = await repo.listLinks(ctx.tenantId, id);
    return reply.send({ data: links.map(linkView) });
  });

  app.post("/v1/helpdesk/road-hotspots", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const body = createHotspotBody.parse(req.body);
    return reply.code(202).send(
      await commands.createHotspot(ctx, {
        location: body.location,
        category: body.category,
        complaintCount: body.complaintCount ?? 0,
        lastComplaintAt: body.lastComplaintAt ?? null,
        maintenancePlanRef: body.maintenancePlanRef ?? null,
      }),
    );
  });

  app.post("/v1/helpdesk/road-hotspots/:id/link-ticket", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { id } = idParam.parse(req.params);
    const body = linkTicketBody.parse(req.body);
    const hotspot = await repo.findHotspot(id, ctx.tenantId);
    if (!hotspot) throw new HttpError(404, "NOT_FOUND", "hotspot not found");
    if (hotspot.status === "resolved") {
      throw new HttpError(409, "HOTSPOT_RESOLVED", "cannot link tickets to a resolved hotspot");
    }
    return reply.code(202).send(await commands.linkTicket(ctx, id, body.ticketId));
  });

  app.post("/v1/helpdesk/road-hotspots/:id/plan-maintenance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { id } = idParam.parse(req.params);
    const body = planMaintenanceBody.parse(req.body);
    const hotspot = await repo.findHotspot(id, ctx.tenantId);
    if (!hotspot) throw new HttpError(404, "NOT_FOUND", "hotspot not found");
    if (hotspot.status === "resolved" || hotspot.status === "work_in_progress") {
      throw new HttpError(409, "INVALID_TRANSITION", "cannot plan maintenance for a hotspot in this status");
    }
    return reply.code(202).send(await commands.planMaintenance(ctx, id, body.maintenancePlanRef));
  });

  app.post("/v1/helpdesk/road-hotspots/:id/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { id } = idParam.parse(req.params);
    const hotspot = await repo.findHotspot(id, ctx.tenantId);
    if (!hotspot) throw new HttpError(404, "NOT_FOUND", "hotspot not found");
    if (!canTransition(hotspot.status as Parameters<typeof canTransition>[0], "resolved")) {
      throw new HttpError(409, "INVALID_TRANSITION", "hotspot must be in work_in_progress status to resolve");
    }
    return reply.code(202).send(await commands.resolveHotspot(ctx, id));
  });
}
