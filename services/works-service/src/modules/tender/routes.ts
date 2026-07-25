import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as v from "./validators.js";
import { getAwardById } from "./repo.js";
import { canDaoFinalizeAward, canDoFinalizeAward } from "./domain.js";

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

  // DAO-finalize award (level 1 of two-level agreement finalization)
  app.post("/v1/works/tenders/award/:id/dao-finalize", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["dao", "works_admin", "super_admin"]);
    const body = v.finalizeAwardSchema.parse({ id: (req.params as { id: string }).id });
    const award = await getAwardById(ctx.tenantId, body.id);
    if (!award) throw new HttpError(404, "NOT_FOUND", "award not found");
    const check = canDaoFinalizeAward(award.status);
    if (!check.allowed) throw new HttpError(422, "FINALIZATION_BLOCKED", check.reason!);

    await queue.publish(COMMANDS.awardDaoFinalize, {
      messageId: randomUUID(),
      type: COMMANDS.awardDaoFinalize,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id: body.id },
    });
    return reply.status(202).send({ id: body.id, status: "accepted" });
  });

  // DO-finalize award (level 2 — requires DAO finalization first)
  app.post("/v1/works/tenders/award/:id/do-finalize", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["do", "works_admin", "super_admin"]);
    const body = v.finalizeAwardSchema.parse({ id: (req.params as { id: string }).id });
    const award = await getAwardById(ctx.tenantId, body.id);
    if (!award) throw new HttpError(404, "NOT_FOUND", "award not found");
    const check = canDoFinalizeAward(award.status);
    if (!check.allowed) throw new HttpError(422, "FINALIZATION_BLOCKED", check.reason!);

    await queue.publish(COMMANDS.awardDoFinalize, {
      messageId: randomUUID(),
      type: COMMANDS.awardDoFinalize,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id: body.id },
    });
    return reply.status(202).send({ id: body.id, status: "accepted" });
  });
}
