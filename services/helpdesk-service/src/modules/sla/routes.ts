import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { tickets } from "../tickets/schema.js";
import { ticketEscalations, slaPolicies, csatResponses } from "./schema.js";
import { evaluateSlaStatus, resolvePolicy, isValidCsatRating, DEFAULT_SLA_POLICIES, type SlaPolicy } from "./domain.js";

const HELPDESK_ROLES = ["helpdesk_user", "helpdesk_agent", "helpdesk_admin", "super_admin", "admin"];
const ADMIN_ROLES = ["helpdesk_admin", "super_admin", "admin"];

const escalateBody = z.object({
  reason: z.string().min(1).max(1000),
});

const slaPolicyBody = z.object({
  priority: z.enum(["critical", "high", "medium", "low"]),
  category: z.string().max(128).nullable().optional(),
  responseMinutes: z.number().int().min(1),
  resolutionMinutes: z.number().int().min(1),
});

const csatBody = z.object({
  ticketId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

export async function slaRoutes(app: FastifyInstance): Promise<void> {
  // ─── SLA Dashboard ──────────────────────────────────────────────────────
  app.get("/v1/helpdesk/sla/dashboard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);

    // Load tenant SLA policies for accurate deadline computation
    // Gracefully fall back to defaults if table doesn't exist yet (migration not run)
    let policyList: SlaPolicy[];
    try {
      // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
      // before this read — a bare db.select() runs with no RLS GUC set.
      const policies = await db.transaction((tx) =>
        tx.select().from(slaPolicies).where(eq(slaPolicies.tenantId, ctx.tenantId)),
      );
      policyList = policies.length > 0
        ? policies.map((p) => ({
            id: p.id,
            tenantId: p.tenantId,
            priority: p.priority,
            category: p.category,
            responseMinutes: p.responseMinutes,
            resolutionMinutes: p.resolutionMinutes,
          }))
        : DEFAULT_SLA_POLICIES.map((p, i) => ({
            id: `default-${i}`,
            tenantId: ctx.tenantId,
            ...p,
          }));
    } catch {
      // Table may not exist yet if migration hasn't run — use defaults
      policyList = DEFAULT_SLA_POLICIES.map((p, i) => ({
        id: `default-${i}`,
        tenantId: ctx.tenantId,
        ...p,
      }));
    }

    // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
    // before this read — a bare db.select() runs with no RLS GUC set.
    const rows = await db.transaction((tx) =>
      tx.select().from(tickets).where(eq(tickets.tenantId, ctx.tenantId)),
    );
    let withinSla = 0;
    let breached = 0;
    let atRisk = 0;
    const now = new Date();

    for (const row of rows) {
      if (row.status === "closed" || row.status === "resolved") {
        withinSla++;
        continue;
      }
      const policy = resolvePolicy(policyList, row.priority, null);
      if (!policy) {
        withinSla++;
        continue;
      }
      const { status } = evaluateSlaStatus(now, new Date(row.createdAt as unknown as string), policy);
      if (status === "breached") breached++;
      else if (status === "at_risk") atRisk++;
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

  // ─── SLA Policies CRUD ──────────────────────────────────────────────────

  /** List SLA policies for tenant */
  app.get("/v1/helpdesk/sla/policies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);

    try {
      // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
      // before this read — a bare db.select() runs with no RLS GUC set.
      const rows = await db.transaction((tx) =>
        tx.select().from(slaPolicies).where(eq(slaPolicies.tenantId, ctx.tenantId)),
      );
      if (rows.length === 0) {
        return reply.send({ data: DEFAULT_SLA_POLICIES, meta: { source: "defaults" } });
      }
      return reply.send({ data: rows, meta: { page: 1, pageSize: rows.length, total: rows.length } });
    } catch {
      // Table may not exist yet
      return reply.send({ data: DEFAULT_SLA_POLICIES, meta: { source: "defaults" } });
    }
  });

  /** Create or update an SLA policy */
  app.post("/v1/helpdesk/sla/policies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = slaPolicyBody.parse(req.body);

    // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
    // before these queries — bare db.select()/db.update()/db.insert() run with no RLS GUC set.
    const { record, created: wasCreated } = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(slaPolicies).where(
        and(
          eq(slaPolicies.tenantId, ctx.tenantId),
          eq(slaPolicies.priority, body.priority),
          body.category
            ? eq(slaPolicies.category, body.category)
            : sql`${slaPolicies.category} IS NULL`,
        ),
      ).limit(1);

      if (existing) {
        // Update existing policy
        const [updated] = await tx.update(slaPolicies)
          .set({
            responseMinutes: body.responseMinutes,
            resolutionMinutes: body.resolutionMinutes,
            updatedBy: ctx.actorId,
            updatedAt: new Date(),
            version: sql`${slaPolicies.version} + 1`,
          })
          .where(eq(slaPolicies.id, existing.id))
          .returning();
        return { record: updated, created: false };
      }

      // Create new policy
      const [created] = await tx.insert(slaPolicies).values({
        tenantId: ctx.tenantId,
        priority: body.priority,
        category: body.category ?? null,
        responseMinutes: body.responseMinutes,
        resolutionMinutes: body.resolutionMinutes,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      }).returning();

      return { record: created, created: true };
    });

    if (wasCreated) {
      return reply.code(201).send({ data: record });
    }
    return reply.send({ data: record });
  });

  // ─── CSAT ───────────────────────────────────────────────────────────────

  /** Submit a CSAT response for a resolved ticket */
  app.post("/v1/helpdesk/csat", async (req, reply) => {
    const ctx = resolveContext(req);
    // Any authenticated user can submit CSAT (the ticket requester)
    const body = csatBody.parse(req.body);

    if (!isValidCsatRating(body.rating)) {
      throw new HttpError(400, "INVALID_RATING", "rating must be an integer between 1 and 5");
    }

    // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
    // before these queries — bare db.select()/db.insert() run with no RLS GUC set.
    const record = await db.transaction(async (tx) => {
      // Verify ticket exists and is resolved
      const [ticket] = await tx.select().from(tickets).where(
        and(eq(tickets.id, body.ticketId), eq(tickets.tenantId, ctx.tenantId)),
      ).limit(1);
      if (!ticket) throw new HttpError(404, "NOT_FOUND", "ticket not found");
      if (ticket.status !== "resolved" && ticket.status !== "closed") {
        throw new HttpError(422, "TICKET_NOT_RESOLVED", "CSAT can only be submitted for resolved/closed tickets");
      }

      // Check if already submitted
      const [existing] = await tx.select().from(csatResponses).where(
        eq(csatResponses.ticketId, body.ticketId),
      ).limit(1);
      if (existing) {
        throw new HttpError(409, "ALREADY_SUBMITTED", "CSAT response already submitted for this ticket");
      }

      const [created] = await tx.insert(csatResponses).values({
        tenantId: ctx.tenantId,
        ticketId: body.ticketId,
        rating: body.rating,
        comment: body.comment ?? null,
        createdBy: ctx.actorId,
      }).returning();

      return created;
    });

    return reply.code(201).send({ data: record });
  });

  /** Get CSAT stats for the tenant */
  app.get("/v1/helpdesk/csat/stats", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);

    // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
    // before this read — a bare db.select() runs with no RLS GUC set.
    const rows = await db.transaction((tx) =>
      tx.select().from(csatResponses).where(eq(csatResponses.tenantId, ctx.tenantId)),
    );
    const total = rows.length;
    if (total === 0) {
      return reply.send({ data: { total: 0, average: null, distribution: {} } });
    }

    const sum = rows.reduce((acc, r) => acc + r.rating, 0);
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of rows) {
      distribution[r.rating] = (distribution[r.rating] ?? 0) + 1;
    }

    return reply.send({
      data: {
        total,
        average: Math.round((sum / total) * 100) / 100,
        distribution,
      },
    });
  });

  // ─── Escalation ─────────────────────────────────────────────────────────

  app.post("/v1/helpdesk/tickets/:id/escalate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = escalateBody.parse(req.body);

    // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
    // before these queries — bare db.select()/db.insert()/db.update() run with no RLS GUC set.
    const record = await db.transaction(async (tx) => {
      const [ticket] = await tx.select().from(tickets).where(and(eq(tickets.id, id), eq(tickets.tenantId, ctx.tenantId))).limit(1);
      if (!ticket) throw new HttpError(404, "NOT_FOUND", "ticket not found");

      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(ticketEscalations)
        .where(and(eq(ticketEscalations.tenantId, ctx.tenantId), eq(ticketEscalations.ticketId, id)));
      const level = (countRow?.count ?? 0) + 1;

      const [created] = await tx.insert(ticketEscalations).values({
        tenantId: ctx.tenantId,
        ticketId: id,
        escalatedBy: ctx.actorId,
        reason: body.reason,
        level,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      }).returning();

      await tx.update(tickets).set({ priority: "High", updatedAt: new Date() }).where(eq(tickets.id, id));
      return created;
    });

    return reply.code(201).send({ data: record });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "invalid request", correlationId } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, correlationId } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "internal error", correlationId } });
  });
}
