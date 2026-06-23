/**
 * P2-003: Comp-Off API
 * - POST /v1/hrms/comp-off (earn comp-off for working on holiday)
 * - GET /v1/hrms/comp-off (list available comp-offs)
 * - POST /v1/hrms/comp-off/:id/redeem (use comp-off as leave)
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { randomUUID } from "node:crypto";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ALL_ROLES = [...HR_ROLES, "manager", "employee"];

const earnCompOffBody = z.object({
  employeeId: z.string().uuid(),
  workedDate: z.string(), // ISO date of when they worked on holiday
  holidayName: z.string().min(1),
  hours: z.number().min(1).max(24).default(8),
  reason: z.string().optional(),
});

const querySchema = z.object({
  employeeId: z.string().uuid().optional(),
  status: z.enum(["available", "redeemed", "expired", "all"]).default("available"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// In-memory store (in production, backed by DB table)
const compOffStore: Array<{
  id: string;
  tenantId: string;
  employeeId: string;
  workedDate: string;
  holidayName: string;
  hours: number;
  reason?: string;
  status: "available" | "redeemed" | "expired";
  redeemedAt?: string;
  createdAt: string;
  createdBy: string;
}> = [];

export async function compOffRoutes(app: FastifyInstance): Promise<void> {
  // Earn comp-off for working on holiday
  app.post("/v1/hrms/comp-off", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const body = earnCompOffBody.parse(req.body);

    const compOff = {
      id: randomUUID(),
      tenantId: ctx.tenantId,
      employeeId: body.employeeId,
      workedDate: body.workedDate,
      holidayName: body.holidayName,
      hours: body.hours,
      reason: body.reason ?? "",
      status: "available" as const,
      createdAt: new Date().toISOString(),
      createdBy: ctx.actorId,
    };

    compOffStore.push(compOff);

    return reply.code(201).send({
      id: compOff.id,
      status: compOff.status,
      message: "comp-off earned",
    });
  });

  // List available comp-offs
  app.get("/v1/hrms/comp-off", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = querySchema.parse(req.query);

    let results = compOffStore.filter((c) => c.tenantId === ctx.tenantId);
    if (q.employeeId) {
      results = results.filter((c) => c.employeeId === q.employeeId);
    }
    if (q.status !== "all") {
      results = results.filter((c) => c.status === q.status);
    }

    return reply.send({ data: results.slice(0, q.limit) });
  });

  // Redeem comp-off as leave
  app.post("/v1/hrms/comp-off/:id/redeem", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = req.params as { id: string };

    const compOff = compOffStore.find((c) => c.id === id && c.tenantId === ctx.tenantId);
    if (!compOff) throw new HttpError(404, "NOT_FOUND", "comp-off not found");
    if (compOff.status === "redeemed") {
      throw new HttpError(409, "ALREADY_REDEEMED", "comp-off has already been redeemed");
    }
    if (compOff.status === "expired") {
      throw new HttpError(422, "EXPIRED", "comp-off has expired and cannot be redeemed");
    }

    compOff.status = "redeemed";
    compOff.redeemedAt = new Date().toISOString();

    return reply.send({
      id: compOff.id,
      status: compOff.status,
      message: "comp-off redeemed as leave",
    });
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
