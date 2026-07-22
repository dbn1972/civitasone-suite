import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as v from "./validators.js";
import { isValidNextStep, eMbFinalizationSequence, billFinalizationSequence, calculateNetPayable } from "./domain.js";
import { getMb, getBill, listBillsForWork } from "./repo.js";

const WRITE_ROLES = ["works_admin", "works_operator", "super_admin", "dao", "do", "sdo", "section_officer", "estimator"];
const READ_ROLES = ["works_admin", "works_operator", "works_viewer", "super_admin", "dao", "do", "sdo", "section_officer", "estimator"];

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  // List bills for a work
  app.get("/v1/works/billing/:workId/bills", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { workId } = req.params as { workId: string };
    const data = await listBillsForWork(ctx.tenantId, workId);
    return reply.send({ data });
  });

  // Issue MB
  app.post("/v1/works/billing/mb", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.issueMbSchema.parse(req.body);
    const id = randomUUID();

    await queue.publish(COMMANDS.mbIssue, {
      messageId: randomUUID(),
      type: COMMANDS.mbIssue,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id, ...body },
    });
    return reply.status(202).send({ id, status: "accepted" });
  });

  // Finalize MB
  app.post("/v1/works/billing/mb/:id/finalize", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.finalizeMbSchema.parse({ ...(req.body as object), id: (req.params as { id: string }).id });
    const mb = await getMb(ctx.tenantId, body.id);
    if (!mb) throw new HttpError(404, "NOT_FOUND", "measurement book not found");

    const seq = eMbFinalizationSequence();
    if (!isValidNextStep(mb.status, body.nextStatus, seq)) {
      throw new HttpError(422, "INVALID_STEP", `Cannot transition from '${mb.status}' to '${body.nextStatus}'`);
    }

    await queue.publish(COMMANDS.mbFinalize, {
      messageId: randomUUID(),
      type: COMMANDS.mbFinalize,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id: body.id, nextStatus: body.nextStatus },
    });
    return reply.status(202).send({ status: "accepted" });
  });

  // Create bill
  app.post("/v1/works/billing/bills", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.createBillSchema.parse(req.body);
    const id = randomUUID();

    await queue.publish(COMMANDS.billCreate, {
      messageId: randomUUID(),
      type: COMMANDS.billCreate,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id, ...body },
    });
    return reply.status(202).send({ id, status: "accepted" });
  });

  // Finalize bill
  app.post("/v1/works/billing/bills/:id/finalize", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.finalizeBillSchema.parse({ ...(req.body as object), id: (req.params as { id: string }).id });
    const bill = await getBill(ctx.tenantId, body.id);
    if (!bill) throw new HttpError(404, "NOT_FOUND", "bill not found");

    const seq = billFinalizationSequence();
    if (!isValidNextStep(bill.status, body.nextStatus, seq)) {
      throw new HttpError(422, "INVALID_STEP", `Cannot transition from '${bill.status}' to '${body.nextStatus}'`);
    }

    await queue.publish(COMMANDS.billFinalize, {
      messageId: randomUUID(),
      type: COMMANDS.billFinalize,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id: body.id, nextStatus: body.nextStatus },
    });
    return reply.status(202).send({ status: "accepted" });
  });
}
