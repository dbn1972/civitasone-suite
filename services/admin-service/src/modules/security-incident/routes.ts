import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import {
  canTransition,
  checkCloseSegregation,
  isBreachOverdue,
  type IncidentStatus,
} from "./service.js";
import * as commands from "./commands.js";

const ADMIN = ["super_admin", "security_admin", "platform_admin"];

export async function securityIncidentRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/admin/security-incidents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = z
      .object({
        title: z.string().min(1).max(256),
        severity: z.enum(["critical", "high", "medium", "low"]),
        category: z.string().max(48).default("other"),
        description: z.string().max(8000).optional(),
        affectedAssets: z.array(z.string()).default([]),
        affectedTenants: z.array(z.string()).default([]),
        isBreach: z.boolean().default(false),
        affectedDataPrincipals: z.number().int().min(0).default(0),
      })
      .parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createIncident(ctx, body));
  });

  app.get("/v1/admin/security-incidents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const rows = await repo.listIncidents(ctx.tenantId);
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  app.get("/v1/admin/security-incidents/breach/overdue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const all = await repo.listBreachNotifications(ctx.tenantId);
    const now = new Date();
    const overdue = all.filter((n) => isBreachOverdue(new Date(n.deadlineAt), n.status, now));
    return reply.send({ data: overdue, meta: { total: overdue.length } });
  });

  app.get("/v1/admin/security-incidents/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const incident = await repo.findIncident(ctx.tenantId, id);
    if (!incident) throw new HttpError(404, "NOT_FOUND", "incident not found");
    const [timeline, breachNotifications] = await Promise.all([
      repo.timelineFor(ctx.tenantId, id),
      repo.breachNotificationsFor(ctx.tenantId, id),
    ]);
    return reply.send({ data: { ...incident, timeline, breachNotifications } });
  });

  app.post("/v1/admin/security-incidents/:id/transition", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        toStatus: z.enum(["triaged", "contained", "resolved"]),
        note: z.string().max(2000).optional(),
        rootCause: z.string().max(4000).optional(),
        resolution: z.string().max(4000).optional(),
      })
      .parse(req.body);
    const inc = await repo.findIncident(ctx.tenantId, id);
    if (!inc) throw new HttpError(404, "NOT_FOUND", "incident not found");
    if (!canTransition(inc.status as IncidentStatus, body.toStatus as IncidentStatus)) {
      throw new HttpError(409, "INVALID_TRANSITION", `cannot move ${inc.status} → ${body.toStatus}`);
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.transitionIncident(ctx, id, body));
  });

  app.post("/v1/admin/security-incidents/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ note: z.string().max(2000).optional() }).parse(req.body);
    const inc = await repo.findIncident(ctx.tenantId, id);
    if (!inc) throw new HttpError(404, "NOT_FOUND", "incident not found");
    if (!canTransition(inc.status as IncidentStatus, "closed")) {
      throw new HttpError(409, "INVALID_TRANSITION", `cannot close from ${inc.status}`);
    }
    const segErr = checkCloseSegregation(inc.reportedBy, ctx.actorId);
    if (segErr) throw new HttpError(409, "MAKER_CHECKER", segErr);
    return sendAccepted(reply, acceptedResponseSchema, await commands.closeIncident(ctx, id, body));
  });

  app.post("/v1/admin/security-incidents/:id/breach-notifications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        authority: z.enum(["data_protection_board", "data_principals"]),
        affectedCount: z.number().int().min(0).default(0),
      })
      .parse(req.body);
    const inc = await repo.findIncident(ctx.tenantId, id);
    if (!inc) throw new HttpError(404, "NOT_FOUND", "incident not found");
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.createBreachNotification(ctx, id, body),
    );
  });

  app.post("/v1/admin/security-incidents/:id/breach-notifications/:nid/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id, nid } = z.object({ id: z.string().uuid(), nid: z.string().uuid() }).parse(req.params);
    const body = z.object({ reference: z.string().min(1).max(128) }).parse(req.body);
    const notifs = await repo.breachNotificationsFor(ctx.tenantId, id);
    const notif = notifs.find((n) => n.id === nid);
    if (!notif) throw new HttpError(404, "NOT_FOUND", "breach notification not found");
    if (notif.status !== "pending") {
      throw new HttpError(409, "INVALID_STATE", `notification already ${notif.status}`);
    }
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.submitBreachNotification(ctx, id, nid, body),
    );
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    }
    req.log.error({ err }, "unhandled");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
