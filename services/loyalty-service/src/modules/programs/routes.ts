import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { isValidTransition, canEdit, validateProgram, type ProgramStatus } from "./domain.js";
import * as commands from "./commands.js";

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

  app.post("/v1/loyalty/programs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createProgramBody.parse(req.body);

    const validation = validateProgram({
      name: body.name,
      earnRatio: BigInt(body.earnRatio),
      expiryDays: body.expiryDays ?? null,
    });
    if (!validation.valid) {
      throw new HttpError(400, "VALIDATION_ERROR", validation.errors.join("; "));
    }

    return reply.code(202).send(
      await commands.createProgram(ctx, {
        name: body.name,
        earnRatio: body.earnRatio,
        expiryDays: body.expiryDays ?? null,
        tierConfig: body.tierConfig ?? {},
      }),
    );
  });

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
    if (body.earnRatio !== undefined) patch.earnRatio = body.earnRatio;
    if (body.expiryDays !== undefined) patch.expiryDays = body.expiryDays;
    if (body.tierConfig !== undefined) patch.tierConfig = body.tierConfig;

    return reply.code(202).send(await commands.updateProgram(ctx, id, { version: body.version, patch }));
  });

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

    return reply
      .code(202)
      .send(await commands.transitionProgram(ctx, id, { status: body.status, version: body.version }));
  });

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

    return reply.code(202).send(await commands.archiveProgram(ctx, id, existing.version));
  });
}
