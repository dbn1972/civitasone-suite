import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import * as repo from "./repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const READER_ROLES = [...HR_ROLES, "manager"];

export async function serviceBookRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/employees/:id/service-book", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const rows = await repo.listServiceBookEntries(ctx.tenantId, id);
    return reply.send({ data: rows });
  });

  app.post("/v1/hrms/employees/:id/service-book", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id: employeeId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      entryType: z.string().min(1),
      effectiveDate: z.string(),
      description: z.string().min(1),
      documentRef: z.string().optional(),
    }).parse(req.body);
    const entryId = randomUUID();
    await publishF3Write(ctx, "service_book_routes__0", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: entryId });
  });

  // Edit an entry — refused once the entry has been attested (immutable).
  app.patch("/v1/hrms/service-book/entries/:entryId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { entryId } = z.object({ entryId: z.string().uuid() }).parse(req.params);
    const body = z.object({
      description: z.string().min(1),
      documentRef: z.string().optional(),
    }).parse(req.body);
    const entry = await repo.getEntry(ctx.tenantId, entryId);
    if (!entry) throw new HttpError(404, "NOT_FOUND", "service book entry not found");
    if (entry.attested) throw new HttpError(409, "ATTESTED_IMMUTABLE", "entry is attested and cannot be edited");
    await repo.updateEntryDescription(ctx.tenantId, entryId, body.description, body.documentRef ?? null);
    return reply.send({ id: entryId, updated: true });
  });

  // Attestation: competent-authority sign-off, immutable thereafter.
  app.post("/v1/hrms/service-book/entries/:entryId/attest", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { entryId } = z.object({ entryId: z.string().uuid() }).parse(req.params);
    const body = z.object({ remarks: z.string().max(1000).optional() }).parse(req.body ?? {});
    const entry = await repo.getEntry(ctx.tenantId, entryId);
    if (!entry) throw new HttpError(404, "NOT_FOUND", "service book entry not found");
    if (entry.attested) throw new HttpError(409, "ALREADY_ATTESTED", "entry is already attested");
    const row = await repo.attestEntry(ctx.tenantId, entryId, ctx.actorId, body.remarks ?? null);
    if (!row) throw new HttpError(409, "ALREADY_ATTESTED", "entry is already attested");
    return reply.send({ id: entryId, attested: true, attestedBy: row.attestedBy, attestedAt: row.attestedAt });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
