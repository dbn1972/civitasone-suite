import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { zMoneyMinorStringNonNeg } from "@civitasone/schemas";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const USER_ROLES = ["parking_user", "parking_admin", "super_admin"];
const ADMIN_ROLES = ["parking_admin", "super_admin"];

const createBody = z.object({
  facilityName: z.string().min(1).max(256),
  facilityType: z.enum(["surface", "multi_level", "basement", "street"]),
  address: z.object({
    line1: z.string().min(1),
    line2: z.string().optional(),
    city: z.string().min(1),
    pin: z.string().min(6).max(6),
    ward: z.string().optional(),
  }),
  ward: z.string().optional(),
  totalSpaces: z.number().int().positive(),
  operatingHours: z.object({
    open: z.string(),
    close: z.string(),
    days: z.array(z.string()).optional(),
  }).optional(),
  // R7 money codec: JSON number OR base-10 string in, canonical bounded STRING
  // out (zMoneyMinorStringNonNeg — packages/schemas/src/money.ts). A plain
  // `z.number().int().nonnegative()` here had no `.max()`, so `Number.isInteger`
  // happily passed values like 1e21; that number then flowed into
  // `BigInt(...)` in facilities/consumer.ts and silently lost precision for
  // anything in the 2^53-2^63 range (same bug class already closed for
  // revenue-service and the municipal cross-events contract). The codec
  // rejects an unsafe-integer number outright and requires a string instead,
  // so the value is never round-tripped through a JS `number` at all.
  tariffPerHourMinor: zMoneyMinorStringNonNeg.optional(),
  tariffPerDayMinor: zMoneyMinorStringNonNeg.optional(),
  monthlyPassMinor: zMoneyMinorStringNonNeg.optional(),
  annualPassMinor: zMoneyMinorStringNonNeg.optional(),
  contactPerson: z.string().optional(),
});

const updateBody = z.object({
  facilityName: z.string().min(1).max(256).optional(),
  totalSpaces: z.number().int().positive().optional(),
  availableSpaces: z.number().int().nonnegative().optional(),
  operatingHours: z.object({
    open: z.string(),
    close: z.string(),
    days: z.array(z.string()).optional(),
  }).optional(),
  // Same money codec as createBody above — see the comment there.
  tariffPerHourMinor: zMoneyMinorStringNonNeg.optional(),
  tariffPerDayMinor: zMoneyMinorStringNonNeg.optional(),
  monthlyPassMinor: zMoneyMinorStringNonNeg.optional(),
  annualPassMinor: zMoneyMinorStringNonNeg.optional(),
  status: z.enum(["active", "full", "closed", "under_maintenance"]).optional(),
  contactPerson: z.string().optional(),
});

const listQuery = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function facilityRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/parking/facilities", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createBody.parse(req.body);
    // Tariff fields are now canonical minor-unit STRINGS (zMoneyMinorStringNonNeg
    // above), not raw numbers: that avoids the earlier BigInt/JSON.stringify
    // crash on real SQS/RabbitMQ drivers (a native bigint isn't serializable)
    // AND the number precision-loss bug (a JS number can silently lose
    // precision above 2^53 before it ever reaches BigInt()). Pass the
    // Zod-validated strings straight through; the consumer rebuilds the exact
    // bigint with BigInt(string) right before the Drizzle insert.
    return reply.code(202).send(await commands.createFacility(ctx, body));
  });

  app.get("/v1/parking/facilities", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({
      data: rows,
      meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total },
    });
  });

  app.get("/v1/parking/facilities/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = `parking:${ctx.tenantId}:facility:${id}`;
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "FACILITY_NOT_FOUND", "Facility not found");
    return reply.send({ data: row });
  });

  app.patch("/v1/parking/facilities/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "FACILITY_NOT_FOUND", "Facility not found");
    // See the note in POST above — same money-codec fix.
    return reply.code(202).send(await commands.updateFacility(ctx, id, body));
  });
}
