import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const USER_ROLES = ["animal_user", "animal_admin", "super_admin"];
const ADMIN_ROLES = ["animal_admin", "super_admin"];

const registerBody = z.object({
  ownerName: z.string().min(1).max(256),
  ownerPhone: z.string().min(10).max(20),
  ownerAddress: z.object({
    line1: z.string().min(1),
    line2: z.string().optional(),
    city: z.string().min(1),
    pin: z.string().min(6).max(6),
  }),
  animalType: z.enum(["dog", "cattle", "cat", "monkey", "pig", "snake", "other"]),
  breed: z.string().max(64).optional(),
  name: z.string().optional(),
  color: z.string().optional(),
  age: z.number().int().nonnegative().optional(),
  sex: z.enum(["male", "female"]).optional(),
  microchipId: z.string().optional(),
  vaccinationRecords: z.array(z.object({
    vaccine: z.string(),
    date: z.string().datetime(),
    nextDue: z.string().datetime().optional(),
    vet: z.string().optional(),
  })).optional(),
  photo: z.string().optional(),
});

const transferBody = z.object({
  newOwnerName: z.string().min(1),
  newOwnerPhone: z.string().min(10).max(20),
});

const listQuery = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function registrationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/animal/registrations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const body = registerBody.parse(req.body);
    return reply.code(202).send(await commands.registerAnimal(ctx, body));
  });

  app.get("/v1/animal/registrations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({
      data: rows,
      meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total },
    });
  });

  app.get("/v1/animal/registrations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = `animal:${ctx.tenantId}:registration:${id}`;
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
    return reply.send({ data: row });
  });

  app.post("/v1/animal/registrations/:id/renew", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
    if (existing.status !== "active" && existing.status !== "expired") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot renew registration in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.renewRegistration(ctx, id));
  });

  app.post("/v1/animal/registrations/:id/transfer", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = transferBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
    if (existing.status !== "active") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot transfer registration in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.transferRegistration(ctx, id, body.newOwnerName, body.newOwnerPhone));
  });
}
