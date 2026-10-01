import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { eq, and, inArray } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { payrollPf } from "./schema.js";
import { payrollSlips } from "../payroll/schema.js";
import { fetchPayrollInput } from "../../shared/hrms-client.js";
import { queue } from "../../shared/infra.js";
import { randomUUID } from "node:crypto";

import { computePensionableWage } from "./ecr-domain.js";

const STATUTORY_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];
const AUDIT_TOPIC = "audit.event.record";

/**
 * EPFO ECR (Electronic Challan cum Return) file generation.
 * Format: pipe-delimited text file as per EPFO specification.
 * Columns: UAN|Member Name|Gross Wages|EPF Wages|EPS Wages|EDLI Wages|
 *          EPF Contribution(EE)|EPS Contribution(ER)|EPF Contribution(ER)|NCP Days|Refund of Advances
 *
 * UAN and member name are sourced from the HRMS employee master; the employer
 * EPS/EPF split is read from the persisted PF record (computed at run time with
 * the Rs 1,250 EPS cap) rather than re-derived here.
 */
export async function ecrRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/statutory/ecr", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, STATUTORY_ROLES);

    const { month } = req.query as { month?: string };
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      throw new HttpError(400, "VALIDATION_FAILED", "month query param required in YYYY-MM format");
    }

    // Fetch PF records for the given period
    const pfRecords = await scopedRead((tx) => tx.select().from(payrollPf)
      .where(and(eq(payrollPf.tenantId, ctx.tenantId), eq(payrollPf.period, month))));

    if (pfRecords.length === 0) {
      throw new HttpError(404, "NOT_FOUND", `No PF records found for period ${month}`);
    }

    // Employee master (UAN + name), keyed by employee id.
    const input = await fetchPayrollInput(ctx.tenantId, month);
    const master = new Map(input.employees.map((e) => [e.id, e]));

    // PERF-005: was one query per PF record to fetch its slip (N+1); now a
    // single inArray() query across all slip ids for this period.
    const slipIds = [...new Set(pfRecords.map((pf) => pf.slipId))];
    const slipRows = slipIds.length
      ? await scopedRead((tx) => tx.select().from(payrollSlips)
          .where(and(inArray(payrollSlips.id, slipIds), eq(payrollSlips.tenantId, ctx.tenantId))))
      : [];
    const slipById = new Map(slipRows.map((s) => [s.id, s]));

    const lines: string[] = [];
    for (const pf of pfRecords) {
      const slip = slipById.get(pf.slipId);
      const emp = master.get(pf.employeeId);

      const grossWages = slip ? Math.round(Number(slip.grossMinor) / 100) : 0;
      const basicWages = slip ? Math.round(Number(slip.basicMinor) / 100) : 0;
      // DA lives in the slip components (no dedicated column on the slip row).
      const components = (slip?.components ?? []) as Array<{ code: string; amountMinor: number }>;
      const daWages = Math.round(components
        .filter((c) => c.code === "DA")
        .reduce((s, c) => s + c.amountMinor, 0) / 100);
      const pensionableWages = computePensionableWage(basicWages, daWages);
      const epfWages = pensionableWages;
      const epsWages = pensionableWages;
      const edliWages = pensionableWages;

      const epfEE = Math.round(Number(pf.empContribMinor) / 100);          // Employee 12%
      // Employer split from the persisted record (EPS capped at Rs 1,250).
      const epsER = Math.round(Number(pf.epsContribMinor) / 100);
      const epfER = Math.round(Number(pf.epfErContribMinor) / 100);
      const ncpDays = 0;
      const refundAdvances = 0;

      // H4: pipe-delimited flat file — strip the field separator and CR/LF from
      // free-text fields so a crafted name/UAN cannot inject or misalign records.
      const pipeSafe = (v: string): string => (v ?? "").replace(/[|\r\n]/g, " ").trim();
      const uan = pipeSafe(emp?.uan ?? "");
      const memberName = pipeSafe(emp?.fullName ?? slip?.employeeNo ?? "");
      const line = [
        uan,
        memberName,
        grossWages,
        epfWages,
        epsWages,
        edliWages,
        epfEE,
        epsER,
        epfER,
        ncpDays,
        refundAdvances,
      ].join("|");
      lines.push(line);
    }

    const ecrContent = lines.join("\r\n");
    const filename = `ECR_${month.replace("-", "")}.txt`;

    // GAP-PAYROLL-STATUTORY-PF-02: the ECR is a bulk export of every PF
    // member's UAN, name and wages. It mutates nothing (so it stays a GET and
    // is idempotent), but every generation is recorded with actor, month and
    // record count -- same read-side audit pattern as Form 16 issuance
    // (form16-pdf/routes.ts). Published before the body is sent so an export
    // that cannot be audited is not delivered.
    await queue.publish(AUDIT_TOPIC, {
      messageId: randomUUID(),
      type: AUDIT_TOPIC,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: {
        service: "payroll",
        action: "export_ecr",
        resourceType: "statutory_ecr",
        resourceId: `ECR:${month}`,
        outcome: "success",
        detail: { month, recordCount: lines.length },
      },
    });

    return reply
      .header("content-type", "text/plain; charset=utf-8")
      .header("content-disposition", `attachment; filename="${filename}"`)
      .send(ecrContent);
  });
}
