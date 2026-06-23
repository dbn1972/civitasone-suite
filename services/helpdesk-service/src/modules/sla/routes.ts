import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { tickets } from "../tickets/schema.js";
import { ticketEscalations } from "./schema.js";

const HELPDESK_ROLES = ["helpdesk_user", "helpdesk_agent", "helpdesk_admin", "super_admin", "admin"];

const escalateBody = z.object({
  reason: z.string().min(1).max(1000),
});

export async function slaRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/helpdesk/sla/dashboard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);

    const rows = await db.select().from(tickets).where(eq(tickets.tenantId, ctx.tenantId));
    let withinSla = 0;
    let breached = 0;
    let atRisk = 0;
    const now = Date.now();
    for (const row of rows) {
      if (row.status === "closed" || row.status === "resolved") {
        withinSla++;
        continue;
      }
      const priority = row.priority?.toLowerCase() ?? "medium";
      const slaDays = (priority === "high" || priority === "critical") ? 3 : 5;
      const due = new Date(row.createdAt as unknown as string).getTime() + slaDays * 86400000;
      const hoursLeft = (due - now) / 3600000;
      if (hoursLeft < 0) breached++;
      else if (hoursLeft < 24) atRisk++;
      else withinSla++;
    }

    return reply.send({
      data: {
        totalTickets: rows.length,
        withinSla,
        breached,
        atRisk,
      },
    });
  });

  app.post("/v1/helpdesk/tickets/:id/escalate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = escalateBody.parse(req.body);

    const [ticket] = await db.select().from(tickets).where(and(eq(tickets.id, id), eq(tickets.tenantId, ctx.tenantId))).limit(1);
    if (!ticket) throw new HttpError(404, "NOT_FOUND", "ticket not found");

    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(ticketEscalations)
      .where(and(eq(ticketEscalations.tenantId, ctx.tenantId), eq(ticketEscalations.ticketId, id)));
    const level = (countRow?.count ?? 0) + 1;

    const [record] = await db.insert(ticketEscalations).values({
      tenantId: ctx.tenantId,
      ticketId: id,
      escalatedBy: ctx.actorId,
      reason: body.reason,
      level,
    }).returning();

    await db.update(tickets).set({ priority: "High", updatedAt: new Date() }).where(eq(tickets.id, id));
    return reply.code(201).send({ data: record });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
