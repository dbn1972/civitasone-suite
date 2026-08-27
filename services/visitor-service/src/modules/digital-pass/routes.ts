/**
 * visitor-service: digital-pass HTTP routes.
 *
 * Follows the established blacklist/routes.ts pattern:
 *   resolveContext → requireRole → zod validate → repo read / command publish → reply
 *
 * Routes:
 *   GET  /v1/visitor/passes/:id       — read single pass (cache.getOrLoad, TTL 5m)
 *   POST /v1/visitor/passes/:id/revoke  — revoke a pass (202 Accepted)
 *   POST /v1/visitor/passes/:id/replace — replace a pass with a new one (202 Accepted)
 *
 * Requirements: 4.5, 4.6
 */
import type { FastifyInstance } from "fastify";
import { pino } from "pino";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { idParam, passRevokeBody, passReplaceBody } from "./validators.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { releaseParkingIfAllocated } from "../vehicle-pass/commands.js";

const log = pino({ name: "digital-pass-routes" });

const READ_ROLES = ["security_admin", "front_desk", "employee", "tenant_admin", "super_admin"];
const WRITE_ROLES = ["security_admin", "front_desk", "tenant_admin", "super_admin"];

export async function digitalPassRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/visitor/passes/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const pass = await repo.getPassById(ctx.tenantId, id);
    if (!pass) throw new HttpError(404, "NOT_FOUND", "digital pass not found");
    return reply.send({ data: pass });
  });

  app.post("/v1/visitor/passes/:id/revoke", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const pass = await repo.getPassById(ctx.tenantId, id);
    if (!pass) throw new HttpError(404, "NOT_FOUND", "digital pass not found");
    const body = passRevokeBody.parse(req.body);
    const accepted = await commands.passRevoke(ctx, { passId: id, reason: body.reason });
    // Fix (2026-08-27 deep-verify): this manual admin revoke is a third
    // place a pass stops being valid (alongside checkout and visit-request
    // cancellation) that never released the pass's parking slot. Same
    // best-effort pattern as those two call sites.
    try {
      await releaseParkingIfAllocated(
        { tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId },
        id,
      );
    } catch (err) {
      log.warn(
        { err, tenantId: ctx.tenantId, passId: id, event: "manual_revoke_parking_release_failed" },
        "parking slot release failed; pass revoke already accepted",
      );
    }
    return reply.code(202).send({ data: accepted });
  });

  app.post("/v1/visitor/passes/:id/replace", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const pass = await repo.getPassById(ctx.tenantId, id);
    if (!pass) throw new HttpError(404, "NOT_FOUND", "digital pass not found");
    const body = passReplaceBody.parse(req.body);
    const accepted = await commands.passReplace(ctx, {
      passId: id,
      reason: body.reason,
      tenantPrivateKeyPem: body.tenantPrivateKeyPem,
    });
    return reply.code(202).send({ data: accepted });
  });
}
