import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { isValidTransition, canEdit, validateProgram, type ProgramStatus } from "./domain.js";

const READ_ROLES = ["loyalty_user", "loyalty_admin", "super_admin"];
const WRITE_ROLES = ["loyalty_admin", "super_admin"];

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const idParam = z.object({ id: z.string().uuid() });

const createProgramBody = z.object({
  name: z.string().min(1).max(200),
  earnRatio: z.coerce.number().int().positive().default(100),
  expiryDays: z.coerce.number().int().positive().optional(),
  tierConfig: z.record(z.unknown()).optional(),
});

const updateProgramBody = z.object({
  name: z.string().min(1).max(200).optional(),
  earnRatio: z.coerce.number().int().positive().optional(),
  expiryDays: z.coerce.number().int().positive().nullable().optional(),
  tierConfig: z.record(z.unknown()).optional(),
  version: z.number().int().min(1),
});

const transitionBody = z.object({
  status: z.enum(["active", "suspended", "archived"]),
  version: z.number().int().min(1),
});

export async function programRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/loyalty/programs — list with pagination
  app.get("/v1/loyalty/programs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuery.parse(req.query);

    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset);
    const page = Math.floor(q.offset / q.limit) + 1;

    return reply.send({
      data: rows.map(repo.toView),
      meta: { page, pageSize: q.limit, total },
    });
  });

  // GET /v1/loyalty/programs/:id
  app.get("/v1/loyalty/programs/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);

    const program = await repo.findById(id, ctx.tenantId);
    if (!program) {
      throw new HttpError(404, "NOT_FOUND", "program not found");
    }

    return reply.send({ data: repo.toView(program) });
  });

  // POST /v1/loyalty/programs — create program (starts as draft)
  app.post("/v1/loyalty/programs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createProgramBody.parse(req.body);
    const id = randomUUID();

    const validation = validateProgram({
      name: body.name,
      earnRatio: BigInt(body.earnRatio),
      expiryDays: body.expiryDays ?? null,
    });
    if (!validation.valid) {
      throw new HttpError(400, "VALIDATION_ERROR", validation.errors.join("; "));
    }

    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        name: body.name,
        status: "draft",
        earnRatio: BigInt(body.earnRatio),
        expiryDays: body.expiryDays ?? null,
        tierConfig: body.tierConfig ?? {},
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.programCreated,
        eventType: EVENTS.programCreated,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { programId: id, name: body.name },
      });
    });

    return reply.code(201).send({
      data: {
        id,
        tenantId: ctx.tenantId,
        name: body.name,
        status: "draft",
        earnRatio: body.earnRatio.toString(),
        expiryDays: body.expiryDays ?? null,
        tierConfig: body.tierConfig ?? {},
        version: 1,
      },
    });
  });

  // PATCH /v1/loyalty/programs/:id — update program fields
  app.patch("/v1/loyalty/programs/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateProgramBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "program not found");
    }
    if (!canEdit(existing.status as ProgramStatus)) {
      throw new HttpError(422, "NOT_EDITABLE", "program cannot be edited in its current state");
    }

    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    if (body.name !== undefined) patch.name = body.name;
    if (body.earnRatio !== undefined) patch.earnRatio = BigInt(body.earnRatio);
    if (body.expiryDays !== undefined) patch.expiryDays = body.expiryDays;
    if (body.tierConfig !== undefined) patch.tierConfig = body.tierConfig;

    const ok = await db.transaction(async (tx) => {
      return repo.update(tx, id, ctx.tenantId, patch, body.version);
    });

    if (!ok) {
      throw new HttpError(409, "VERSION_CONFLICT", "program has been modified; retry with current version");
    }

    return reply.send({ data: { id, updated: true, version: body.version + 1 } });
  });

  // POST /v1/loyalty/programs/:id/activate — transition to active
  app.post("/v1/loyalty/programs/:id/activate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = transitionBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "program not found");
    }

    if (!isValidTransition(existing.status as ProgramStatus, body.status)) {
      throw new HttpError(422, "INVALID_TRANSITION", `cannot transition from ${existing.status} to ${body.status}`);
    }

    const ok = await db.transaction(async (tx) => {
      return repo.update(tx, id, ctx.tenantId, { status: body.status, updatedBy: ctx.actorId }, body.version);
    });

    if (!ok) {
      throw new HttpError(409, "VERSION_CONFLICT", "program has been modified; retry with current version");
    }

    return reply.send({ data: { id, status: body.status, version: body.version + 1 } });
  });

  // DELETE /v1/loyalty/programs/:id — archive program
  app.delete("/v1/loyalty/programs/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "program not found");
    }

    if (!isValidTransition(existing.status as ProgramStatus, "archived")) {
      throw new HttpError(422, "INVALID_TRANSITION", `cannot archive program in state ${existing.status}`);
    }

    const ok = await db.transaction(async (tx) => {
      return repo.update(tx, id, ctx.tenantId, { status: "archived", updatedBy: ctx.actorId }, existing.version);
    });

    if (!ok) {
      throw new HttpError(409, "VERSION_CONFLICT", "program has been modified; retry with current version");
    }

    return reply.send({ data: { id, status: "archived" } });
  });
}
