/**
 * S8-G4 -- /v1/hrms/admin/grade-bands: the tenant's private grade bands (C2, T3, M2 ...).
 *
 * Reads: any HR role (the designation, wizard and payslip screens need the list). Writes: HR admin.
 * Every write is a command (202 + queue, the HRMS convention); the consumer writes the row and its
 * audit event in one transaction. The routes pre-check what they can so a doomed request answers
 * 4xx instead of a false 202. A band that designations still point at can be deactivated (it then
 * cannot be chosen for new links) but never deleted.
 */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { createGradeBandBody, updateGradeBandBody, gradeBandListQuery, idParam } from "./validators.js";
import * as repo from "./repo.js";
import * as cmd from "./commands.js";

const ADMIN_ROLES = ["hr_admin", "super_admin", "admin", "tenant_admin", "platform_admin"];
export const GRADE_BAND_READ_ROLES = [...ADMIN_ROLES, "hr_officer", "manager", "officer", "payroll_admin", "payroll_officer"];

export async function gradeBandRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/admin/grade-bands", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GRADE_BAND_READ_ROLES);
    const q = gradeBandListQuery.parse(req.query);
    const data = await scopedRead((tx) => repo.listBands(tx, ctx.tenantId, q.includeInactive !== "false"));
    return reply.send({ data });
  });

  app.post("/v1/hrms/admin/grade-bands", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createGradeBandBody.parse(req.body);
    const dupe = await scopedRead((tx) => repo.findBandByCode(tx, ctx.tenantId, body.code));
    if (dupe) {
      return reply.code(409).send({
        code: "DUPLICATE_CODE", message: `Grade band "${body.code}" already exists.`,
        fieldErrors: [{ field: "code", message: "This code is already in use." }],
      });
    }
    return sendAccepted(reply, acceptedResponseSchema, await cmd.createGradeBand(ctx, body));
  });

  app.patch("/v1/hrms/admin/grade-bands/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateGradeBandBody.parse(req.body);
    const band = await scopedRead((tx) => repo.findBand(tx, ctx.tenantId, id));
    if (!band) throw new HttpError(404, "NOT_FOUND", "grade band not found");
    if (body.expectedVersion !== undefined && body.expectedVersion !== band.version) {
      throw new HttpError(409, "VERSION_CONFLICT", "this grade band was changed by someone else; reload and retry");
    }
    // The range must hold for the row AFTER the change, not just for the fields sent.
    const min = body.ctcMinMinor !== undefined ? body.ctcMinMinor : band.ctcMinMinor;
    const max = body.ctcMaxMinor !== undefined ? body.ctcMaxMinor : band.ctcMaxMinor;
    if (min !== null && max !== null && min > max) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request",
        fieldErrors: [{ field: "ctcMinMinor", message: "The minimum CTC cannot be above the maximum." }],
      });
    }
    return sendAccepted(reply, acceptedResponseSchema, await cmd.updateGradeBand(ctx, id, body));
  });

  for (const action of ["deactivate", "reactivate"] as const) {
    app.post(`/v1/hrms/admin/grade-bands/:id/${action}`, async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, ADMIN_ROLES);
      const { id } = idParam.parse(req.params);
      const band = await scopedRead((tx) => repo.findBand(tx, ctx.tenantId, id));
      if (!band) throw new HttpError(404, "NOT_FOUND", "grade band not found");
      const want = action === "reactivate";
      if (band.isActive === want) throw new HttpError(409, want ? "ALREADY_ACTIVE" : "ALREADY_INACTIVE", `this grade band is already ${want ? "active" : "inactive"}`);
      return sendAccepted(reply, acceptedResponseSchema, await cmd.setGradeBandActive(ctx, id, want));
    });
  }

  app.delete("/v1/hrms/admin/grade-bands/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const { band, used } = await scopedRead(async (tx) => {
      const band = await repo.findBand(tx, ctx.tenantId, id);
      return { band, used: band ? await repo.countDesignationsOnBand(tx, ctx.tenantId, id) : 0 };
    });
    if (!band) throw new HttpError(404, "NOT_FOUND", "grade band not found");
    if (used > 0) {
      return reply.code(409).send({
        code: "BAND_IN_USE", count: used,
        message: `${used} designation${used === 1 ? "" : "s"} still use this band — move them to another band first, or deactivate it instead.`,
      });
    }
    return sendAccepted(reply, acceptedResponseSchema, await cmd.deleteGradeBand(ctx, id));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
