import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { runWithTenant } from "@civitasone/db";
import { listQuerySchema } from "@civitasone/schemas/common";
import { auditEventsListSchema, TenantAuditEventListSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as queries from "./queries.js";

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.get("/audit/events", async (req, reply) => {
    const ctx = resolveContext(req);
    const q = listQuerySchema.extend({
      tenantId: z.string().uuid().optional(),
      from:     z.string().datetime().optional(),
      to:       z.string().datetime().optional(),
      type:     z.string().optional(),
    }).parse(req.query);
    const tenantId = q.tenantId ?? ctx.tenantId;
    if (tenantId !== ctx.tenantId && !ctx.roles.some((r) => ["platform_admin", "super_admin", "audit_admin"].includes(r))) {
      throw new HttpError(403, "FORBIDDEN", "cross-tenant audit access denied");
    }
    requireRole(ctx, ["audit_officer", "audit_admin", "super_admin", "platform_admin"]);
    const from = q.from ? new Date(q.from) : new Date(Date.now() - 7 * 86400 * 1000);
    const to   = q.to   ? new Date(q.to)   : new Date();
    // G-FIX-3: the RLS tenant GUC is set once per request from the caller's
    // OWN JWT tenant (app.ts's onRequest hook, via AsyncLocalStorage) and is
    // never re-derived from a route's resolved target tenantId. Without this
    // explicit override, an admin's cross-tenant request silently queries
    // events.events with app.tenant_id still pinned to their own tenant, so
    // RLS filters out every row of the OTHER tenant's data before it reaches
    // this handler — a bare success with an always-empty list, not an error.
    // Confirmed live before this fix: a super_admin querying a tenant with
    // 1,690 real events (00000000-0000-0000-0000-000000000001) got back [].
    const events = await runWithTenant(tenantId, () => queries.listEvents(tenantId, from, to, q.type, q.limit, q.offset));
    sendValidated(reply, auditEventsListSchema, events);
  });

  app.get("/v1/audit/events", async (req, reply) => {
    const ctx = resolveContext(req);
    const q = listQuerySchema.extend({
      tenantId: z.string().uuid().optional(),
      // Bugfix: z.coerce.boolean() coerces via JS Boolean(str), so the
      // querystring "false" (a non-empty string) coerced to `true` — the
      // tenantScoped=false cross-tenant gate below could never activate.
      // Parse the literal "true"/"false" strings instead.
      tenantScoped: z.enum(["true", "false"]).optional().transform((v) => (v === undefined ? undefined : v === "true")),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      type: z.string().optional(),
    }).parse(req.query);
    requireRole(ctx, ["audit_officer", "audit_admin", "super_admin", "platform_admin"]);
    const tenantId = q.tenantScoped === false ? (q.tenantId ?? ctx.tenantId) : ctx.tenantId;
    // P0-2: cross-tenant trail reads (tenantScoped=false, or an explicit foreign tenantId)
    // require an admin/platform role — audit_officer must stay scoped to its own tenant.
    if (tenantId !== ctx.tenantId && !ctx.roles.some((r) => ["platform_admin", "super_admin", "audit_admin"].includes(r))) {
      throw new HttpError(403, "FORBIDDEN", "cross-tenant audit access denied");
    }
    const from = q.from ? new Date(q.from) : new Date(Date.now() - 7 * 86400 * 1000);
    const to = q.to ? new Date(q.to) : new Date();
    // G-FIX-3: see the identical note on GET /audit/events above — this
    // handler has the same tenantScoped=false cross-tenant admin path and
    // needs the same explicit GUC override, or it silently returns an empty
    // list for any tenant other than the caller's own.
    const events = await runWithTenant(tenantId, () => queries.listEvents(tenantId, from, to, q.type, q.limit, q.offset));
    sendValidated(reply, TenantAuditEventListSchema, events.map((event) => ({
      id: event.id,
      actor: typeof event.actor === "object" && event.actor !== null && "email" in event.actor
        ? String(event.actor.email)
        : typeof event.actor === "object" && event.actor !== null && "name" in event.actor
          ? String(event.actor.name)
          : "system",
      action: event.type,
      resource: event.target ?? undefined,
      outcome: event.severity === "error" || event.severity === "critical" ? "failure" : "success",
      timestamp: event.occurredAt,
    })));
  });

  app.get("/audit/events/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["audit_officer", "audit_admin", "super_admin", "platform_admin"]);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const view = await queries.getEvent(ctx.tenantId, id);
    if (!view) throw new HttpError(404, "NOT_FOUND", "event not found");
    return reply.send(view);
  });


  // Gap-fix: v1-prefixed detail route — the gateway strips /api/v1/audit and
  // forwards /events/:id, so this path must exist alongside the legacy /audit/events/:id.
  app.get("/v1/audit/events/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["audit_officer", "audit_admin", "super_admin", "platform_admin"]);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const view = await queries.getEvent(ctx.tenantId, id);
    if (!view) throw new HttpError(404, "NOT_FOUND", "event not found");
    return reply.send({
      id: view.id,
      actor: typeof view.actor === "object" && view.actor !== null && "email" in view.actor
        ? String(view.actor.email)
        : typeof view.actor === "object" && view.actor !== null && "name" in view.actor
          ? String(view.actor.name)
          : "system",
      action: view.type,
      resource: view.target ?? undefined,
      outcome: view.severity === "error" || view.severity === "critical" ? "failure" : "success",
      timestamp: view.occurredAt,
      severity: view.severity,
      correlationId: view.correlationId,
    });
  });


  // AU-GAP-1: entity audit trail — events for a specific resource (type + id).
  // The target column stores resourceId; resourceType is queried from payload JSONB.
  app.get("/v1/audit/entities/:type/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["audit_officer", "audit_admin", "super_admin", "platform_admin"]);
    const { type, id } = z.object({
      type: z.string().min(1).max(128),
      id:   z.string().min(1).max(256),
    }).parse(req.params);
    const q = listQuerySchema.parse(req.query);
    const events = await queries.listEventsByEntity(ctx.tenantId, type, id, q.limit, q.offset);
    return reply.send(events);
  });

  // AU-GAP-2: write an audit event directly via API (admin / internal use).
  // The async queue path is preferred for cross-service events; this is the
  // synchronous API path for internal tooling and compliance workflows.
  app.post("/v1/audit/events", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["audit_admin", "super_admin", "platform_admin"]);
    const body = z.object({
      type:         z.string().min(1).max(128),
      resourceType: z.string().min(1).max(128),
      resourceId:   z.string().min(1).max(256),
      severity:     z.enum(["info", "warning", "error", "critical"]).default("info"),
      payload:      z.record(z.unknown()).optional().default({}),
    }).parse(req.body);
    const id = await queries.writeEvent(
      ctx.tenantId,
      ctx.actorId,
      body.type,
      body.resourceType,
      body.resourceId,
      body.severity,
      body.payload as Record<string, unknown>,
      ctx.correlationId,
      (req.headers["x-forwarded-for"] as string | undefined) ?? req.ip,
      req.headers["user-agent"] as string | undefined,
    );
    return reply.status(201).send({ id });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
