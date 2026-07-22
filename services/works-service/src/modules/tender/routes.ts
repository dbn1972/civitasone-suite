import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as v from "./validators.js";

const WRITE_ROLES = ["works_admin", "works_operator", "super_admin", "dao", "do", "sdo"];
const READ_ROLES = ["works_admin", "works_operator", "works_viewer", "super_admin", "dao", "do", "sdo", "section_officer", "estimator"];

export async function tenderRoutes(app: FastifyInstance): Promise<void> {
  // Create pre-tender
  app.post("/v1/works/tenders/pre-tender", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.createPreTenderSchema.parse(req.body);
    const id = randomUUID();

    await queue.publish(COMMANDS.preTenderCreate, {
      messageId: randomUUID(),
      type: COMMANDS.preTenderCreate,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id, ...body },
    });
    return reply.status(202).send({ id, status: "accepted" });
  });

  // Add quotation
  app.post("/v1/works/tenders/quotation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.addQuotationSchema.parse(req.body);
    const id = randomUUID();

    await queue.publish(COMMANDS.quotationAdd, {
      messageId: randomUUID(),
      type: COMMANDS.quotationAdd,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id, ...body },
    });
    return reply.status(202).send({ id, status: "accepted" });
  });

  // Create award
  app.post("/v1/works/tenders/award", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.createAwardSchema.parse(req.body);
    const id = randomUUID();

    await queue.publish(COMMANDS.awardCreate, {
      messageId: randomUUID(),
      type: COMMANDS.awardCreate,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id, ...body },
    });
    return reply.status(202).send({ id, status: "accepted" });
  });
}
