import type { FastifyInstance } from "fastify";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as v from "./validators.js";
import * as commands from "./commands.js";
import { isValidNextStep, eMbFinalizationSequence, billFinalizationSequence, canCreateBill, billAmountExceedsAward } from "./domain.js";
import { getMb, getBill, listBillsForWork } from "./repo.js";
import { getAwardById } from "../tender/repo.js";
import { parseMinor } from "@civitasone/schemas";

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

    const award = await getAwardById(ctx.tenantId, body.awardId);
    if (!award) throw new HttpError(404, "NOT_FOUND", "award not found");
    const priorBills = await listBillsForWork(ctx.tenantId, body.workId);
    const priorBilledGross = priorBills.reduce(
      (sum, row) => sum + (row.grossAmountMinor ?? 0n),
      0n,
    );
    const newGross = parseMinor(body.grossAmountMinor);
    if (billAmountExceedsAward(priorBilledGross, newGross, award.acceptedAmountMinor)) {
      throw new HttpError(
        422,
        "AWARD_CEILING_EXCEEDED",
        "Cumulative bill gross amount exceeds accepted award ceiling",
      );
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
