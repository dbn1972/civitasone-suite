import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./office-repo.js";

const READER_ROLES = ["finance_officer", "finance_admin", "super_admin", "audit_officer"];
const WRITER_ROLES = ["finance_admin", "super_admin"];

const createOfficeBody = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,31}$/, "Use 2-32 letters, digits, - or _"),
  name: z.string().trim().min(2, "Office name is required").max(200),
});
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export async function officeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/finance/offices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listOffices(ctx.tenantId, q.limit, q.offset);
    return reply.send({
      data: rows.map((r) => ({ id: r.id, code: r.code, name: r.name, isActive: r.isActive })),
      total, limit: q.limit, offset: q.offset,
    });
  });

  app.post("/v1/finance/offices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITER_ROLES);
    const body = createOfficeBody.parse(req.body);
    if (await repo.findOfficeByCode(ctx.tenantId, body.code)) {
      throw new HttpError(409, "OFFICE_CODE_EXISTS", "an office with this code already exists", [
        { field: "code", message: "This office code is already in use." },
      ]);
    }
    const id = randomUUID();
    await queue.publish(COMMANDS.officeCreate, {
      messageId: id, type: COMMANDS.officeCreate,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, ...body },
    });
    return reply.code(202).send({ id, status: "accepted" });
  });

  app.setErrorHandler(financeErrorHandler);
}
