/**
 * winback/routes.ts — HTTP routes for the win-back cadence engine (G9).
 *
 * Cadence CRUD: crm_admin only.
 * Enrollment operations: crm_user or crm_admin.
 */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { listQuery, windowOf, listEnvelope } from "../../shared/list-query.js";
import * as queries from "./queries.js";
import * as commands from "./commands.js";
import {
  createCadenceBody,
  updateCadenceBody,
  enrollAccountBody,
  recordOutcomeBody,
} from "./validators.js";
import { validateSteps, validateTriggerCriteria } from "./domain.js";

const ADMIN_ROLES = ["crm_admin", "super_admin", "tenant_admin"];
const USER_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];

const cadenceListQuery = listQuery.merge(
  z.object({ status: z.enum(["draft", "active", "archived"]).optional() }),
);

const enrollmentListQuery = listQuery.merge(
  z.object({
    cadenceId: z.string().uuid().optional(),
    accountId: z.string().uuid().optional(),
    status: z.enum(["active", "completed", "cancelled", "converted"]).optional(),
  }),
);

export async function winbackRoutes(app: FastifyInstance): Promise<void> {
  // ── Cadence routes (crm_admin) ──────────────────────────────────────────

  app.get("/v1/crm/winback-cadences", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const q = cadenceListQuery.parse(req.query ?? {});
    const w = windowOf(q);

    const { rows, total } = await queries.listCadences(ctx.tenantId, w.pageSize, w.offset, q.status);
    return reply.send(listEnvelope(rows, w, total));
  });

  app.post("/v1/crm/winback-cadences", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createCadenceBody.parse(req.body);

    // Domain validation
    const criteriaCheck = validateTriggerCriteria(body.triggerCriteria);
    if (!criteriaCheck.valid) {
      throw new HttpError(422, "INVALID_CRITERIA", criteriaCheck.reason);
    }
    const stepsCheck = validateSteps(body.steps);
    if (!stepsCheck.valid) {
      throw new HttpError(422, "INVALID_STEPS", stepsCheck.reason);
    }

    const id = randomUUID();
    await commands.publishCreateCadence(ctx, id, body);
    return reply.status(202).send({ data: { id } });
  });

  app.patch("/v1/crm/winback-cadences/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = updateCadenceBody.parse(req.body);
    const version = z.coerce.number().int().min(1).parse((req.headers as Record<string, unknown>)["if-match"] ?? 1);

    if (body.triggerCriteria) {
      const criteriaCheck = validateTriggerCriteria(body.triggerCriteria);
      if (!criteriaCheck.valid) {
        throw new HttpError(422, "INVALID_CRITERIA", criteriaCheck.reason);
      }
    }
    if (body.steps) {
      const stepsCheck = validateSteps(body.steps);
      if (!stepsCheck.valid) {
        throw new HttpError(422, "INVALID_STEPS", stepsCheck.reason);
      }
    }

    await commands.publishUpdateCadence(ctx, id, body, version);
    return reply.status(202).send({ data: { id } });
  });

  // ── Enrollment routes (crm_user) ────────────────────────────────────────

  app.get("/v1/crm/winback-enrollments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const q = enrollmentListQuery.parse(req.query ?? {});
    const w = windowOf(q);

    const { rows, total } = await queries.listEnrollments(ctx.tenantId, w.pageSize, w.offset, {
      ...(q.cadenceId !== undefined && { cadenceId: q.cadenceId }),
      ...(q.accountId !== undefined && { accountId: q.accountId }),
      ...(q.status !== undefined && { status: q.status }),
    });
    return reply.send(listEnvelope(rows, w, total));
  });

  app.post("/v1/crm/winback-enrollments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const body = enrollAccountBody.parse(req.body);

    const id = randomUUID();
    await commands.publishEnrollAccount(ctx, id, body.cadenceId, body.accountId);
    return reply.status(202).send({ data: { id } });
  });

  app.post("/v1/crm/winback-enrollments/:id/advance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const version = z.coerce.number().int().min(1).parse((req.headers as Record<string, unknown>)["if-match"] ?? 1);

    await commands.publishAdvanceEnrollment(ctx, id, version);
    return reply.status(202).send({ data: { id } });
  });

  app.post("/v1/crm/winback-enrollments/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const version = z.coerce.number().int().min(1).parse((req.headers as Record<string, unknown>)["if-match"] ?? 1);

    await commands.publishCancelEnrollment(ctx, id, version);
    return reply.status(202).send({ data: { id } });
  });

  app.post("/v1/crm/winback-enrollments/:id/outcome", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = recordOutcomeBody.parse(req.body);
    const version = z.coerce.number().int().min(1).parse((req.headers as Record<string, unknown>)["if-match"] ?? 1);

    await commands.publishRecordOutcome(ctx, id, body.outcome, version);
    return reply.status(202).send({ data: { id } });
  });
}
