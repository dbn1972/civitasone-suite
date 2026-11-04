/**
 * PR #2459 review B1: opening YTD commands (CQRS: the routes publish, the
 * consumer writes). Maker-checker: the approver must differ from the officer
 * who entered the record; checked here (409/403 up front) and re-asserted in
 * the consumer under the row lock.
 */
import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { COMMANDS } from "../../topics.js";
import { payrollOpeningYtd, type OpeningYtdRow } from "../payroll/schema.js";
import type { CreateOpeningYtdBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function listOpeningYtd(tenantId: string, q: { employeeId?: string | undefined; fy?: string | undefined }): Promise<OpeningYtdRow[]> {
  return scopedRead((tx) => tx.select().from(payrollOpeningYtd).where(and(
    eq(payrollOpeningYtd.tenantId, tenantId),
    q.employeeId ? eq(payrollOpeningYtd.employeeId, q.employeeId) : undefined,
    q.fy ? eq(payrollOpeningYtd.fy, q.fy) : undefined,
  )).orderBy(payrollOpeningYtd.fy, payrollOpeningYtd.source).limit(500));
}

export async function findOpeningYtd(tenantId: string, id: string): Promise<OpeningYtdRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(payrollOpeningYtd)
    .where(and(eq(payrollOpeningYtd.id, id), eq(payrollOpeningYtd.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

/**
 * The identity of an opening record: employee, FY, source and -- for a previous
 * employer -- the employer (TAN, else the name), so several previous employers
 * in one FY each have their own record (Form 12B per employer). Pure.
 */
export function openingYtdKey(r: { source: string; priorEmployerTan?: string | null | undefined; priorEmployerName?: string | null | undefined }): string {
  return r.source === "prior_employer" ? `prior:${(r.priorEmployerTan ?? "").toUpperCase() || (r.priorEmployerName ?? "").trim().toLowerCase()}` : "pre_go_live";
}

export async function createOpeningYtd(ctx: RequestContext, body: CreateOpeningYtdBody): Promise<Accepted> {
  const rows = await scopedRead((tx) => tx.select().from(payrollOpeningYtd).where(and(
    eq(payrollOpeningYtd.tenantId, ctx.tenantId), eq(payrollOpeningYtd.employeeId, body.employeeId),
    eq(payrollOpeningYtd.fy, body.fy), eq(payrollOpeningYtd.source, body.source), ne(payrollOpeningYtd.status, "rejected"),
  )));
  const key = openingYtdKey(body);
  const same = rows.filter((r) => openingYtdKey(r) === key);
  if (same.some((r) => r.status === "pending")) throw new HttpError(409, "OPENING_YTD_PENDING", `an opening YTD (${body.source}) for ${body.fy} is already pending approval for this employee`);
  const approved = same.find((r) => r.status === "approved");
  if (body.supersedesId) {
    const target = rows.find((r) => r.id === body.supersedesId);
    if (!target || target.status !== "approved" || openingYtdKey(target) !== key) {
      throw new HttpError(422, "OPENING_YTD_SUPERSEDE_INVALID", "supersedesId must name the APPROVED opening YTD of the same employee, FY, source and employer");
    }
  } else if (approved) {
    throw new HttpError(409, "OPENING_YTD_EXISTS", `an approved opening YTD (${body.source}) for ${body.fy} already exists for this employee; send a correction with supersedesId`);
  }
  const id = randomUUID();
  await queue.publish(COMMANDS.openingYtdCreate, {
    messageId: id, type: COMMANDS.openingYtdCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function decideOpeningYtd(ctx: RequestContext, id: string, decision: "approved" | "rejected", reason: string): Promise<Accepted> {
  const row = await findOpeningYtd(ctx.tenantId, id);
  if (!row) throw new HttpError(404, "NOT_FOUND", "opening YTD record not found");
  if (row.status !== "pending") throw new HttpError(409, "OPENING_YTD_DECIDED", `this record is already ${row.status}`);
  if (row.enteredBy === ctx.actorId) throw new HttpError(403, "MAKER_CHECKER_VIOLATION", "the opening YTD must be approved or rejected by someone other than the officer who entered it");
  await queue.publish(COMMANDS.openingYtdDecide, {
    messageId: randomUUID(), type: COMMANDS.openingYtdDecide,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, decision, reason },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
