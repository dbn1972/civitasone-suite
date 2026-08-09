import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const ADMIN_ROLES = ["crematorium_admin", "super_admin"];

const recordBody = z.object({
  bookingId: z.string().uuid(),
  facilityId: z.string().uuid(),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slotNumber: z.string().optional(),
  serviceType: z.enum(["cremation", "burial", "electric_cremation"]),
  notes: z.string().optional(),
  completionCertificateRef: z.string().optional(),
});

const facilityParam = z.object({ facilityId: z.string().uuid() });

const listQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

export async function recordRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/crematorium/records", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = recordBody.parse(req.body);
    return reply.code(202).send(await commands.recordService(ctx, body));
  });

  app.get("/v1/crematorium/facilities/:facilityId/records", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { facilityId } = facilityParam.parse(req.params);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listByFacility(facilityId, ctx.tenantId, q);
    return reply.send({
      data: rows,
      meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total },
    });
  });
}
