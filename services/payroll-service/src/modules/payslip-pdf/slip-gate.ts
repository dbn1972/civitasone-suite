import { randomUUID } from "node:crypto";
import { HttpError, type resolveContext } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";

/**
 * GAP-PAYROLL-SALARY-SLIPS-05 / GAP-PAYROLL-SLIPS-DETAIL-05: a payslip may be
 * printed or downloaded only once it is final. payroll_slips.status is one of
 * computed | approved | paid | held | exception (payroll_slips_status_check);
 * only "paid" is final -- the money has actually been disbursed. "exception"
 * (negative net) is never disbursed, and computed/approved/held can still
 * change. Matches the web's isPrintableSlipStatus (its extra "finalized" is
 * not a value this table can hold), but enforced HERE so the gate is not
 * UI-only: both GET /v1/payroll/slips/:id/pdf and .../download call this.
 */
export const PRINTABLE_SLIP_STATUSES: readonly string[] = ["paid"];

export function assertSlipPrintable(status: string): void {
  if (!PRINTABLE_SLIP_STATUSES.includes(status)) {
    throw new HttpError(409, "SLIP_NOT_FINAL", `salary slip is ${status}; only a paid slip can be printed or downloaded`);
  }
}

const AUDIT_TOPIC = "audit.event.record";

/**
 * Payslip issuance is a read of salary + identity PII, audited the same way
 * this service audits form16_signed and bank_file_generated (service +
 * action on audit.event.record): service "payroll", action "slip_downloaded".
 */
export async function publishSlipDownloadAudit(
  ctx: ReturnType<typeof resolveContext>,
  slipId: string,
  route: "pdf" | "download",
): Promise<void> {
  await queue.publish(AUDIT_TOPIC, {
    messageId: randomUUID(),
    type: AUDIT_TOPIC,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      service: "payroll",
      action: "slip_downloaded",
      resourceType: "payroll_slip",
      resourceId: slipId,
      outcome: "success",
      detail: { route },
    },
  });
}
