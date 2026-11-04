import { minorFromDb, toSafeInt, roundMinorToRupees } from "../../shared/money.js";
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { eq, and, inArray } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { payrollPf } from "./schema.js";
import { notExcludedSlip } from "./repo.js";
import { payrollSlips } from "../payroll/schema.js";
import { fetchPayrollInput } from "../../shared/hrms-client.js";
import { queue } from "../../shared/infra.js";
import { randomUUID } from "node:crypto";

import { computePensionableWage, buildEcrFile, uanProblems, ncpDaysFromComponents, EPF_WAGE_CEILING, type EcrMemberLine } from "./ecr-domain.js";

const STATUTORY_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];
const AUDIT_TOPIC = "audit.event.record";

/**
 * EPFO ECR (Electronic Challan cum Return) file generation, ECR 2.0 text
 * format (fields separated by "#~#", spec and column order in ecr-domain.ts).
 * UAT b18 D4: was pipe-delimited, which the EPFO portal does not accept.
 * UAT b18 D3: refused (422 UAN_MISSING, listing the members) while any EPF
 * member has a missing or invalid (not 12-digit) UAN, instead of writing a
 * blank UAN column.
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
      .where(and(eq(payrollPf.tenantId, ctx.tenantId), eq(payrollPf.period, month), notExcludedSlip(payrollPf.slipId))));

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

    const problems = uanProblems(pfRecords.map((pf) => ({
      employeeId: pf.employeeId,
      employeeNo: master.get(pf.employeeId)?.employeeNo ?? slipById.get(pf.slipId)?.employeeNo ?? null,
      uan: master.get(pf.employeeId)?.uan ?? null,
    })));
    if (problems.length > 0) {
      const list = problems.map((p) => `${p.employeeNo ?? p.employeeId} (${p.problem})`).join(", ");
      return reply.code(422).send({
        code: "UAN_MISSING",
        message: `ECR not generated: ${problems.length} EPF member(s) have a missing or invalid UAN (12 digits required): ${list}`,
        correlationId: ctx.correlationId,
        retryable: false,
        employees: problems,
      });
    }

    const members: EcrMemberLine[] = [];
    for (const pf of pfRecords) {
      const slip = slipById.get(pf.slipId);
      const emp = master.get(pf.employeeId);

      const grossWages = slip ? toSafeInt(roundMinorToRupees(minorFromDb(slip.grossMinor))) : 0;
      const basicWages = slip ? toSafeInt(roundMinorToRupees(minorFromDb(slip.basicMinor))) : 0;
      // DA lives in the slip components (no dedicated column on the slip row).
      const components = (slip?.components ?? []) as Array<{ code: string; amountMinor: number | string }>;
      const daWages = toSafeInt(roundMinorToRupees(components
        .filter((c) => c.code === "DA")
        .reduce((s, c) => s + minorFromDb(c.amountMinor), 0n)));
      const pensionableWages = computePensionableWage(basicWages, daWages);
      // UAT b18 D5 / D6: the wages persisted with the PF row (migration 0162) are
      // the ones the contributions were computed on (configured ceilings); rows
      // written before it fall back to min(Basic + DA, Rs 15,000).
      const epfWages = pf.epfWageMinor != null ? toSafeInt(roundMinorToRupees(minorFromDb(pf.epfWageMinor))) : pensionableWages;
      const epsWages = epfWages > EPF_WAGE_CEILING ? EPF_WAGE_CEILING : epfWages;
      const edliWages = pf.edliWageMinor != null ? toSafeInt(roundMinorToRupees(minorFromDb(pf.edliWageMinor))) : pensionableWages;

      const epfEE = toSafeInt(roundMinorToRupees(minorFromDb(pf.empContribMinor)));          // Employee 12%
      // Employer split from the persisted record (EPS capped at Rs 1,250).
      const epsER = toSafeInt(roundMinorToRupees(minorFromDb(pf.epsContribMinor)));
      const epfER = toSafeInt(roundMinorToRupees(minorFromDb(pf.epfErContribMinor)));
      // NCP days = the loss-of-pay days recorded on the slip LOP line.
      const ncpDays = ncpDaysFromComponents(components as Array<{ code: string; lopDays?: number }>);
      const refundAdvances = 0;

      // H4: ecrText (ecr-domain.ts) strips the separator characters and CR/LF
      // from the free-text fields so a crafted name cannot misalign records.
      members.push({
        uan: (emp?.uan ?? "").trim(),
        memberName: emp?.fullName ?? slip?.employeeNo ?? "",
        grossWages, epfWages, epsWages, edliWages,
        epfContributionEe: epfEE, epsContributionEr: epsER, epfEpsDiffEr: epfER,
        ncpDays, refundOfAdvances: refundAdvances,
      });
    }

    const ecrContent = buildEcrFile(members);
    const lines = members;
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
