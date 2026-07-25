import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as v from "./validators.js";
import { calculateBoqAmount } from "./domain.js";
import { listBoqItems, getRecapitulation } from "./repo.js";

const WRITE_ROLES = ["works_admin", "works_operator", "super_admin", "estimator", "sdo", "section_officer"];
const READ_ROLES = ["works_admin", "works_operator", "works_viewer", "super_admin", "dao", "do", "sdo", "section_officer", "estimator"];

export async function boqRoutes(app: FastifyInstance): Promise<void> {
  // List BoQ items for a work
  app.get("/v1/works/boq/:workId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { workId } = req.params as { workId: string };
    const data = await listBoqItems(ctx.tenantId, workId);
    return reply.send({ data });
  });

  // Get recapitulation for a work
  app.get("/v1/works/boq/:workId/recapitulation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { workId } = req.params as { workId: string };
    const data = await getRecapitulation(ctx.tenantId, workId);
    if (!data) throw new HttpError(404, "NOT_FOUND", "recapitulation not found");
    return reply.send({ data });
  });

  // Add BoQ item
  app.post("/v1/works/boq", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.addBoqItemSchema.parse(req.body);
    const id = randomUUID();

    await queue.publish(COMMANDS.boqAddItem, {
      messageId: randomUUID(),
      type: COMMANDS.boqAddItem,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id, ...body },
    });
    return reply.status(202).send({ id, status: "accepted" });
  });

  // Recapitulate
  app.post("/v1/works/boq/recapitulate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.recapitulateSchema.parse(req.body);
    const id = randomUUID();

    await queue.publish(COMMANDS.boqRecapitulate, {
      messageId: randomUUID(),
      type: COMMANDS.boqRecapitulate,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id, ...body },
    });
    return reply.status(202).send({ id, status: "accepted" });
  });

  // Update BoQ item
  app.patch("/v1/works/boq/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.updateBoqItemSchema.parse({ ...(req.body as object), id: (req.params as { id: string }).id });

    await queue.publish(COMMANDS.boqUpdateItem, {
      messageId: randomUUID(),
      type: COMMANDS.boqUpdateItem,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { ...body },
    });
    return reply.status(202).send({ id: body.id, status: "accepted" });
  });

  // Delete BoQ item
  app.delete("/v1/works/boq/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.deleteBoqItemSchema.parse({ id: (req.params as { id: string }).id });

    await queue.publish(COMMANDS.boqDeleteItem, {
      messageId: randomUUID(),
      type: COMMANDS.boqDeleteItem,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id: body.id },
    });
    return reply.status(202).send({ id: body.id, status: "accepted" });
  });
}
