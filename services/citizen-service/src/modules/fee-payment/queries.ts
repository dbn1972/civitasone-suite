import { db } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import type { RequestContext } from "@civitasone/types";
import * as repo from "./repo.js";
import { computeFee } from "./domain.js";
import type { ComputeFeeBody } from "./validators.js";
import type { FeeScheduleRow } from "./schema.js";

export async function listSchedules(tenantId: string) {
  return repo.listSchedules(tenantId);
}

export async function getPayment(tenantId: string, id: string) {
  return repo.findPaymentById(id, tenantId);
}

export async function listPaymentsByApplication(tenantId: string, applicationId: string) {
  return repo.listPaymentsByApplication(tenantId, applicationId);
}

export async function listRefunds(tenantId: string, paymentId: string) {
  return repo.listRefundsByPayment(tenantId, paymentId);
}

async function resolveSchedule(tx: repo.Writer, ctx: RequestContext, scheduleId?: string, serviceId?: string): Promise<FeeScheduleRow> {
  let sched = scheduleId ? await repo.findScheduleByIdTx(tx, scheduleId, ctx.tenantId) : null;
  if (!sched && serviceId) sched = await repo.findActiveScheduleForService(tx, ctx.tenantId, serviceId);
  if (!sched) throw new HttpError(404, "NO_FEE_SCHEDULE", "no active fee schedule found");
  return sched;
}

/** Pure compute — no mutation. */
export async function computeApplicationFee(ctx: RequestContext, body: ComputeFeeBody) {
  return db.transaction(async (tx) => {
    const sched = await resolveSchedule(tx, ctx, body.scheduleId, body.serviceId);
    return { ...computeFee(Number(sched.baseAmount), sched.exemptions, body.subject), currency: sched.currency };
  });
}
