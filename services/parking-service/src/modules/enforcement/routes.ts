import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const USER_ROLES = ["parking_user", "parking_admin", "super_admin"];
const ADMIN_ROLES = ["parking_admin", "super_admin"];

const issueBody = z.object({
  location: z.object({
    lat: z.number().optional(),
    lng: z.number().optional(),
    address: z.string().optional(),
    zone: z.string().optional(),
  }).optional(),
  vehicleNumber: z.string().min(1).max(20),
  violationType: z.enum(["no_ticket", "expired", "wrong_zone", "obstruction"]),
  photo: z.string().optional(),
  challanRef: z.string().optional(),
});

const payBody = z.object({
  paymentRef: z.string().min(1),
});

const contestBody = z.object({
  reason: z.string().min(1),
});

const listQuery = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function enforcementRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/parking/violations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = issueBody.parse(req.body);
    return reply.code(202).send(await commands.issueViolation(ctx, body));
  });

  app.get("/v1/parking/violations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({
      data: rows,
      meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total },
    });
  });

  app.get("/v1/parking/violations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.findById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "VIOLATION_NOT_FOUND", "Violation not found");
    return reply.send({ data: row });
  });

  app.post("/v1/parking/violations/:id/pay", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = payBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "VIOLATION_NOT_FOUND", "Violation not found");
    if (existing.status !== "issued") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot pay violation in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.payViolation(ctx, id, body.paymentRef));
  });

  app.post("/v1/parking/violations/:id/contest", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = contestBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "VIOLATION_NOT_FOUND", "Violation not found");
    if (existing.status !== "issued") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot contest violation in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.contestViolation(ctx, id, body.reason));
  });
}
