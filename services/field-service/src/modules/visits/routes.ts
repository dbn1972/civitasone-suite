import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, isFieldSupervisor, assertAssignedOrSupervisor, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as taskRepo from "../tasks/repo.js";
import { validateCheckIn, validateCheckOut, calculateDurationMinutes, classifyVisitOutcome } from "./domain.js";
import * as commands from "./commands.js";

const FIELD_ROLES = ["field_admin", "field_agent", "super_admin"];

const checkInBody = z.object({
  taskId: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const checkOutBody = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  notes: z.string().max(2000).optional(),
  photos: z.array(z.string()).max(10).default([]),
});

const idParam = z.object({ id: z.string().uuid() });

const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// GAP-FIELD-VISITS-04: optional inclusive calendar-day range on check-in, in IST
// (the product timezone). YYYY-MM-DD only; a real calendar date, from <= to.
const IST_OFFSET = "+05:30";
const dayString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
  }, "not a real calendar date");

const visitListQuery = historyQuery
  .extend({ from: dayString.optional(), to: dayString.optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: "from must be on or before to", path: ["from"] });

/** [from 00:00 IST, day-after-to 00:00 IST) so the `to` day is included whole. */
function istRange(from?: string, to?: string): { from?: Date; toExclusive?: Date } | undefined {
  if (!from && !to) return undefined;
  const range: { from?: Date; toExclusive?: Date } = {};
  if (from) range.from = new Date(`${from}T00:00:00.000${IST_OFFSET}`);
  if (to) {
    const next = new Date(`${to}T00:00:00.000${IST_OFFSET}`);
    next.setUTCDate(next.getUTCDate() + 1);
    range.toExclusive = next;
  }
  return range;
}

const taskIdParam = z.object({ taskId: z.string().uuid() });
const agentIdParam = z.object({ agentId: z.string().uuid() });

export async function visitRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/field/visits — recent visits with GPS check-in/out (P1-10)
  app.get("/v1/field/visits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const q = visitListQuery.parse(req.query);
    const { rows, total } = await repo.listRecent(
      ctx.tenantId, q.limit, q.offset, isFieldSupervisor(ctx) ? undefined : ctx.actorId, istRange(q.from, q.to),
    );
    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({ data: rows.map(repo.toView), meta: { page, pageSize: q.limit, total } });
  });

  // POST /v1/field/visits/check-in — record check-in at location
  app.post("/v1/field/visits/check-in", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const body = checkInBody.parse(req.body);

    const locationError = validateCheckIn({ latitude: body.latitude, longitude: body.longitude });
    if (locationError) {
      throw new HttpError(422, "INVALID_LOCATION", locationError);
    }

    const task = await taskRepo.findById(body.taskId, ctx.tenantId);
    if (!task) {
      throw new HttpError(404, "NOT_FOUND", "task not found");
    }
    await assertAssignedOrSupervisor(ctx, task, "check-in", req.log);

    return reply.code(202).send(
      await commands.checkIn(ctx, {
        taskId: body.taskId,
        latitude: body.latitude,
        longitude: body.longitude,
        checkInAt: new Date().toISOString(),
      }),
    );
  });

  // POST /v1/field/visits/:id/check-out — record check-out
  app.post("/v1/field/visits/:id/check-out", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const { id } = idParam.parse(req.params);
    const body = checkOutBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "visit not found");
    }

    const checkOutAt = new Date();
    const checkOutError = validateCheckOut(existing.checkInAt?.toISOString() ?? null, checkOutAt.toISOString());
    if (checkOutError) {
      throw new HttpError(422, "INVALID_CHECKOUT", checkOutError);
    }

    const durationMinutes = calculateDurationMinutes(existing.checkInAt!.toISOString(), checkOutAt.toISOString());
    const outcome = classifyVisitOutcome(durationMinutes);

    return reply.code(202).send(
      await commands.checkOut(ctx, id, {
        taskId: existing.taskId,
        checkOutAt: checkOutAt.toISOString(),
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
        notes: body.notes ?? null,
        photos: body.photos,
        durationMinutes,
        outcome,
        version: existing.version,
      }),
    );
  });

  // GET /v1/field/visits/by-task/:taskId — history by task
  app.get("/v1/field/visits/by-task/:taskId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const { taskId } = taskIdParam.parse(req.params);
    const q = historyQuery.parse(req.query);

    const { rows, total } = await repo.findByTaskId(taskId, ctx.tenantId, q.limit, q.offset, isFieldSupervisor(ctx) ? undefined : ctx.actorId);
    const page = Math.floor(q.offset / q.limit) + 1;

    return reply.send({ data: rows.map(repo.toView), meta: { page, pageSize: q.limit, total } });
  });

  // GET /v1/field/visits/by-agent/:agentId — history by agent
  app.get("/v1/field/visits/by-agent/:agentId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const { agentId } = agentIdParam.parse(req.params);
    const q = historyQuery.parse(req.query);
    if (!isFieldSupervisor(ctx) && agentId !== ctx.actorId) {
      throw new HttpError(403, "FORBIDDEN", "field agents may only view their own visits");
    }

    const { rows, total } = await repo.findByAgent(agentId, ctx.tenantId, q.limit, q.offset);
    const page = Math.floor(q.offset / q.limit) + 1;

    return reply.send({ data: rows.map(repo.toView), meta: { page, pageSize: q.limit, total } });
  });

  // GET /v1/field/visits/:id — get single visit
  app.get("/v1/field/visits/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const { id } = idParam.parse(req.params);

    const visit = await repo.findById(id, ctx.tenantId);
    if (!visit || (!isFieldSupervisor(ctx) && visit.agentId !== ctx.actorId)) {
      throw new HttpError(404, "NOT_FOUND", "visit not found");
    }

    return reply.send({ data: repo.toView(visit) });
  });
}
