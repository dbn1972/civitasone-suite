import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  fileRtiBody, assignPioBody, respondRtiBody, appealRtiBody, closeRtiBody, idParam,
} from "./validators.js";
import * as repo from "./repo.js";
import type { RtiRow } from "./schema.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];

// SLA: open (not responded/closed) requests are overdue once today > due_date.
function withSla(row: RtiRow): RtiRow & { overdue: boolean; daysToDue: number } {
  const today = new Date().toISOString().slice(0, 10);
  const open = row.status === "filed" || row.status === "assigned";
  const msPerDay = 86_400_000;
  const daysToDue = Math.round((Date.parse(row.dueDate) - Date.parse(today)) / msPerDay);
  return { ...row, overdue: open && today > row.dueDate, daysToDue };
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function rtiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/rti/requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const rows = await repo.listRti(ctx.tenantId);
    return reply.send({ data: rows.map(withSla) });
  });

  app.get("/v1/hrms/rti/requests/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.getRti(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "RTI request not found");
    return reply.send({ data: withSla(row) });
  });

  // File a new RTI request — computes the 30-day SLA due date.
  app.post("/v1/hrms/rti/requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = fileRtiBody.parse(req.body);
    const id = randomUUID();
    const dueDate = addDays(body.receivedDate, body.slaDays);
    await publishF3Write(ctx, "rti_routes__0", id, {
      body: { ...(req.body as Record<string, unknown>), dueDate },
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
    });
    return reply.code(202).send({ id, status: "accepted", dueDate }) as any;
  });

  // Assign a PIO (filed -> assigned).
  app.post("/v1/hrms/rti/requests/:id/assign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = assignPioBody.parse(req.body);
    const existing = await repo.getRti(ctx.tenantId, id);
    if (!existing || existing.status !== "filed") {
      throw new HttpError(409, "INVALID_STATE", "request must be 'filed' to assign a PIO");
    }
    await publishF3Write(ctx, "rti_routes__1", id, {
      body: { ...(req.body as Record<string, unknown>), from: ["filed"], to: "assigned" },
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
    });
    return reply.code(202).send({ id, status: "accepted", pioId: body.pioId }) as any;
  });

  // PIO responds (filed|assigned -> responded).
  app.post("/v1/hrms/rti/requests/:id/respond", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = respondRtiBody.parse(req.body);
    const existing = await repo.getRti(ctx.tenantId, id);
    if (!existing || (existing.status !== "filed" && existing.status !== "assigned")) {
      throw new HttpError(409, "INVALID_STATE", "request must be open to respond");
    }
    await publishF3Write(ctx, "rti_routes__2", id, {
      body: { ...(req.body as Record<string, unknown>), from: ["filed", "assigned"], to: "responded" },
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
    });
    return reply.code(202).send({ id, status: "accepted" }) as any;
  });

  // First appeal (responded -> appealed).
  app.post("/v1/hrms/rti/requests/:id/appeal", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = appealRtiBody.parse(req.body);
    const existing = await repo.getRti(ctx.tenantId, id);
    if (!existing || existing.status !== "responded") {
      throw new HttpError(409, "INVALID_STATE", "only a responded request can be appealed");
    }
    await publishF3Write(ctx, "rti_routes__3", id, {
      body: { ...(req.body as Record<string, unknown>), from: ["responded"], to: "appealed" },
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
    });
    return reply.code(202).send({ id, status: "accepted" }) as any;
  });

  // Close (responded|appealed -> closed).
  app.post("/v1/hrms/rti/requests/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = closeRtiBody.parse(req.body);
    const existing = await repo.getRti(ctx.tenantId, id);
    if (!existing || (existing.status !== "responded" && existing.status !== "appealed")) {
      throw new HttpError(409, "INVALID_STATE", "request must be responded or appealed to close");
    }
    await publishF3Write(ctx, "rti_routes__4", id, {
      body: { ...(req.body as Record<string, unknown>), from: ["responded", "appealed"], to: "closed" },
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
    });
    return reply.code(202).send({ id, status: "accepted" }) as any;
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
