import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as programRepo from "../programs/repo.js";
import { validateEnrolment, isValidTransition, type EnrolmentStatus } from "./domain.js";

const READ_ROLES = ["loyalty_user", "loyalty_admin", "super_admin"];
const WRITE_ROLES = ["loyalty_admin", "super_admin"];

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  programId: z.string().uuid().optional(),
});

const idParam = z.object({ id: z.string().uuid() });
const profileIdParam = z.object({ profileId: z.string().uuid() });

const enrolBody = z.object({
  programId: z.string().uuid(),
  profileId: z.string().uuid(),
  tier: z.string().max(50).default("base"),
});

const statusBody = z.object({
  status: z.enum(["active", "suspended", "cancelled"]),
  version: z.number().int().min(1),
});

export async function enrolmentRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/loyalty/enrol — enrol a profile in a program
  app.post("/v1/loyalty/enrol", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = enrolBody.parse(req.body);

    // Validate program exists and is active
    const program = await programRepo.findById(body.programId, ctx.tenantId);
    if (!program) {
      throw new HttpError(404, "NOT_FOUND", "program not found");
    }

    // Check for duplicate
    const existing = await repo.findByProgramAndProfile(ctx.tenantId, body.programId, body.profileId);

    const validation = validateEnrolment({
      programStatus: program.status,
      existingEnrolment: existing !== null && existing.status !== "cancelled",
    });
    if (!validation.valid) {
      throw new HttpError(422, "ENROLMENT_INVALID", validation.error!);
    }

    const id = randomUUID();
    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        programId: body.programId,
        profileId: body.profileId,
        status: "active",
        tier: body.tier,
        pointsBalance: BigInt(0),
        lifetimePoints: BigInt(0),
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.memberEnrolled,
        eventType: EVENTS.memberEnrolled,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { enrolmentId: id, programId: body.programId, profileId: body.profileId },
      });
    });

    return reply.code(201).send({
      data: {
        id,
        programId: body.programId,
        profileId: body.profileId,
        status: "active",
        tier: body.tier,
        pointsBalance: "0",
        lifetimePoints: "0",
        version: 1,
      },
    });
  });

  // GET /v1/loyalty/enrolments — list enrolments (optionally by program)
  app.get("/v1/loyalty/enrolments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuery.parse(req.query);

    const { rows, total } = q.programId
      ? await repo.listByProgram(ctx.tenantId, q.programId, q.limit, q.offset)
      : await repo.listByTenant(ctx.tenantId, q.limit, q.offset);

    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({ data: rows.map(repo.toView), meta: { page, pageSize: q.limit, total } });
  });

  // GET /v1/loyalty/members/:profileId — list enrolments for a profile
  app.get("/v1/loyalty/members/:profileId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { profileId } = profileIdParam.parse(req.params);
    const q = listQuery.parse(req.query);

    const { rows, total } = await repo.listByProfile(ctx.tenantId, profileId, q.limit, q.offset);
    const page = Math.floor(q.offset / q.limit) + 1;

    return reply.send({ data: rows.map(repo.toView), meta: { page, pageSize: q.limit, total } });
  });

  // GET /v1/loyalty/enrolments/:id — get single enrolment
  app.get("/v1/loyalty/enrolments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);

    const enrolment = await repo.findById(id, ctx.tenantId);
    if (!enrolment) {
      throw new HttpError(404, "NOT_FOUND", "enrolment not found");
    }

    return reply.send({ data: repo.toView(enrolment) });
  });

  // PATCH /v1/loyalty/enrolments/:id/status — suspend or cancel
  app.patch("/v1/loyalty/enrolments/:id/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = statusBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "enrolment not found");
    }

    if (!isValidTransition(existing.status as EnrolmentStatus, body.status)) {
      throw new HttpError(422, "INVALID_TRANSITION", `cannot transition from ${existing.status} to ${body.status}`);
    }

    const ok = await db.transaction(async (tx) => {
      return repo.update(tx, id, ctx.tenantId, { status: body.status, updatedBy: ctx.actorId }, body.version);
    });

    if (!ok) {
      throw new HttpError(409, "VERSION_CONFLICT", "enrolment has been modified; retry with current version");
    }

    return reply.send({ data: { id, status: body.status, version: body.version + 1 } });
  });
}
