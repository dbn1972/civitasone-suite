import type { FastifyInstance } from "fastify";
import { z } from "zod";
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
  tariffPerHourMinor: z.number().int().nonnegative().optional(),
  tariffPerDayMinor: z.number().int().nonnegative().optional(),
  monthlyPassMinor: z.number().int().nonnegative().optional(),
  annualPassMinor: z.number().int().nonnegative().optional(),
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
  tariffPerHourMinor: z.number().int().nonnegative().optional(),
  tariffPerDayMinor: z.number().int().nonnegative().optional(),
  monthlyPassMinor: z.number().int().nonnegative().optional(),
  annualPassMinor: z.number().int().nonnegative().optional(),
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
    // Was: BigInt(...) here, then publishCommand -> queue.publish() ->
    // JSON.stringify(msg) on the real SQS/RabbitMQ drivers (MemoryQueue, used in
    // tests, never serializes, which is why this went unnoticed). Native BigInt
    // throws "Do not know how to serialize a BigInt" — every create/update with
    // any tariff field set would fail on a real deployment, meaning there was no
    // way via this API to ever populate the tariff fields the booking/pass fee
    // fix now depends on. facilities/consumer.ts already expects these as
    // strings (see its payload type) — routes.ts was the one side of the pipe
    // not following that contract. Pass the Zod-validated numbers straight
    // through; the consumer converts to BigInt right before the Drizzle insert.
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
    // See the note in POST above — same BigInt/JSON.stringify crash fix.
    return reply.code(202).send(await commands.updateFacility(ctx, id, body));
  });
}
