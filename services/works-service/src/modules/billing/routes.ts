import type { FastifyInstance } from "fastify";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as v from "./validators.js";
import * as commands from "./commands.js";
import { isValidNextStep, eMbFinalizationSequence, billFinalizationSequence, canCreateBill } from "./domain.js";
import { getMb, getBill, listBillsForWork, listBills } from "./repo.js";

const WRITE_ROLES = ["works_admin", "works_operator", "super_admin", "dao", "do", "sdo", "section_officer", "estimator"];
const READ_ROLES = ["works_admin", "works_operator", "works_viewer", "super_admin", "dao", "do", "sdo", "section_officer", "estimator"];

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  // Tenant-wide bills register — backs the /works/billing list page. Static
  // segment wins over :workId, so this cannot shadow the per-work route.
  app.get("/v1/works/billing/bills", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = req.query as { page?: string; pageSize?: string };
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(q.pageSize) || 100));
    const data = await listBills(ctx.tenantId, page, pageSize);
    return reply.send({ data });
  });

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
    return sendAccepted(reply, acceptedResponseSchema, await commands.issueMbCommand(ctx, body));
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

    return sendAccepted(reply, acceptedResponseSchema, await commands.finalizeMbCommand(ctx, body.id, body.nextStatus));
  });

  // Create bill
  app.post("/v1/works/billing/bills", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.createBillSchema.parse(req.body);

    // canCreateBill gate: a bill referencing an MB may only be created once
    // that MB is fully finalized (do_finalized). Enforced here (pre-enqueue)
    // AND defensively in the consumer — see billing/consumer.ts billCreate.
    if (body.mbId) {
      const mb = await getMb(ctx.tenantId, body.mbId);
      if (!mb) throw new HttpError(404, "NOT_FOUND", "measurement book not found");
      if (!canCreateBill(mb.status)) {
        throw new HttpError(
          409,
          "MB_NOT_ELIGIBLE",
          `Cannot create bill: measurement book status is '${mb.status}', must be 'do_finalized'`,
        );
      }
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.createBillCommand(ctx, body));
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

    return sendAccepted(reply, acceptedResponseSchema, await commands.finalizeBillCommand(ctx, body.id, body.nextStatus));
  });

  // Record a measurement against an MB
  app.post("/v1/works/billing/measurements", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.recordMeasurementSchema.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.recordMeasurementCommand(ctx, body));
  });

  // Compile monthly account
  app.post("/v1/works/billing/account-compile", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["dao", "do", "works_admin", "super_admin"]);
    const body = v.compileAccountSchema.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.compileAccountCommand(ctx, body));
  });
}
