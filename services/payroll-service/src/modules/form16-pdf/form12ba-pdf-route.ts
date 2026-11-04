/**
 * Form No. 12BA [See rule 26A(2)(b)] as an issuable PDF (UAT ux-docs: 12BA had no printable
 * output at all, only JSON). Statement of particulars of perquisites, other fringe benefits or
 * amenities and profits in lieu of salary, laid out in the order of the rule format.
 *
 *   GET /v1/payroll/statutory/form12ba/pdf?employeeId=&fy=2026-27
 *
 * Same access rule as the JSON statement: an employee only their own; a staff lookup is audited.
 * The employer (name, address, TAN) comes from tenant configuration; generation is refused when
 * it is not configured.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  DocumentNotIssuableError, OfficialPdf, formatDateIst, formatMinorIndian, maskPanForPrint,
} from "@civitasone/render/official";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopeEmployeeId, staffRolesOf, isRouteStaff } from "../../shared/employee-scope.js";
import { scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { minorFromDb } from "../../shared/money.js";
import { perquisiteComponents, taxDeclarations } from "../tax/schema.js";
import { buildForm16, parseFy } from "../tax/form16.js";
import { fetchPayrollInput, HrmsUnavailableError } from "../../shared/hrms-client.js";
import { loadLetterhead } from "../letterhead/routes.js";
import { resolveForm16Deductor, type Form16Deductor } from "./form16-document.js";

const READER_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer", "employee"];
const READER_STAFF_ROLES = staffRolesOf(READER_ROLES);
const AUDIT_TOPIC = "audit.event.record";

/** The perquisite rows of Form 12BA, in rule order; a recorded component lands on the row its nature names. */
export const FORM12BA_NATURES: Array<{ label: string; match: RegExp }> = [
  { label: "Accommodation", match: /accommodation|house|quarter|rent/i },
  { label: "Cars / Other automotive", match: /car|vehicle|automotive|motor/i },
  { label: "Sweeper, gardener, watchman or personal attendant", match: /sweeper|gardener|watchman|attendant|servant/i },
  { label: "Gas, electricity, water", match: /gas|electric|water/i },
  { label: "Interest free or concessional loans", match: /loan/i },
  { label: "Holiday expenses", match: /holiday/i },
  { label: "Free or concessional travel", match: /travel|ltc|ticket/i },
  { label: "Free meals", match: /meal|food|canteen/i },
  { label: "Free education", match: /education|school/i },
  { label: "Gifts, vouchers, etc.", match: /gift|voucher/i },
  { label: "Credit card expenses", match: /credit card/i },
  { label: "Club expenses", match: /club/i },
  { label: "Use of movable assets by employees", match: /use of (movable )?asset|laptop|furniture/i },
  { label: "Transfer of assets to employees", match: /transfer of asset/i },
  { label: "Value of any other benefit / amenity / service / privilege", match: /amenity|privilege|service/i },
  { label: "Stock options allotted or transferred by employer being an eligible start-up referred to in section 80-IAC", match: /80-?iac|start-?up/i },
  { label: "Stock options (non-qualified options) other than ESOP in col. 16 above", match: /esop|stock option|esos/i },
  { label: "Contribution by employer to fund and scheme taxable under section 17(2)(vii)", match: /17\(2\)\(vii\)(?!a)|employer contribution|superannuation|nps|provident/i },
  { label: "Annual accretion by way of interest, dividend etc. to the balance at the credit of fund and scheme referred to in section 17(2)(vii) and taxable under section 17(2)(viia)", match: /viia|accretion/i },
  { label: "Other benefits or amenities", match: /$^/ },
];

export interface Form12baComponent { nature: string; description: string; valueMinor: bigint; recoveredMinor: bigint; taxableMinor: bigint }

export interface Form12baModel {
  fy: string;
  assessmentYear: string;
  employer: Form16Deductor;
  employee: { name: string; designation: string | null; pan: string | null };
  /** Income under the head Salaries other than perquisites (rupees, from the Form 16 build). */
  salaryIncomeMinor: bigint;
  components: Form12baComponent[];
  /** Declared aggregate perquisite when no itemised component exists. */
  aggregatePerquisiteMinor: bigint;
  taxDeductedMinor: bigint;
  responsible: { name: string | null; designation: string | null };
  generatedAt?: Date;
}

/** Rows 1-20 with (value, recovered, taxable) and the row-21 total. */
export function form12baRows(m: Form12baModel): { rows: Array<{ label: string; v: bigint; r: bigint; t: bigint }>; total: { v: bigint; r: bigint; t: bigint } } {
  const rows = FORM12BA_NATURES.map((n) => ({ label: n.label, v: 0n, r: 0n, t: 0n }));
  const other = rows[rows.length - 1]!;
  if (m.components.length === 0 && m.aggregatePerquisiteMinor > 0n) {
    other.v = m.aggregatePerquisiteMinor; other.t = m.aggregatePerquisiteMinor;
  }
  for (const c of m.components) {
    const idx = FORM12BA_NATURES.findIndex((n) => n.match.test(`${c.nature} ${c.description}`));
    const row = idx >= 0 ? rows[idx]! : other;
    row.v += c.valueMinor; row.r += c.recoveredMinor; row.t += c.taxableMinor;
  }
  const total = rows.reduce((a, r) => ({ v: a.v + r.v, r: a.r + r.r, t: a.t + r.t }), { v: 0n, r: 0n, t: 0n });
  return { rows, total };
}

export async function renderForm12baPdf(m: Form12baModel): Promise<Uint8Array> {
  const pdf = await OfficialPdf.create({
    title: `Form 12BA ${m.fy}`,
    lang: "bilingual",
    footerNote: `Form No. 12BA · FY ${m.fy} · ${m.employee.name}`,
    ...(m.generatedAt ? { generatedAt: m.generatedAt } : {}),
  });
  pdf.title("FORM NO. 12BA", "प्ररूप सं. 12खक");
  pdf.paragraph("[See rule 26A(2)(b)]", { align: "center", size: 9 });
  pdf.paragraph("Statement showing particulars of perquisites, other fringe benefits or amenities and profits in lieu of salary with value thereof",
    { align: "center", bold: true });
  pdf.fields([
    { label: "1. Name and address of employer", value: [m.employer.name, m.employer.address].filter(Boolean).join(", ") },
    { label: "2. TAN", value: m.employer.tan },
    { label: "3. TDS Assessment Range of the employer", value: "" },
    { label: "4. Name, designation and PAN of employee", value: [m.employee.name, m.employee.designation, maskPanForPrint(m.employee.pan) || "PANNOTAVBL"].filter(Boolean).join(", ") },
    { label: "5. Is the employee a director or a person with substantial interest in the company (where the employer is a company)", value: "Not applicable" },
    { label: "6. Income under the head \"Salaries\" of the employee (other than from perquisites)", value: `₹ ${formatMinorIndian(m.salaryIncomeMinor)}` },
    { label: "7. Financial year", value: `${m.fy} (Assessment year ${m.assessmentYear})` },
    { label: "8. Valuation of perquisites", value: "See the table below" },
  ], 1);
  const { rows, total } = form12baRows(m);
  const f = formatMinorIndian;
  pdf.table({
    size: 8,
    columns: [
      { header: "S. No.", width: 0.6, align: "center" },
      { header: "Nature of perquisites (see rule 3)", width: 4 },
      { header: "Value of perquisite as per rules (₹)", width: 1.4, align: "right" },
      { header: "Amount, if any, recovered from the employee (₹)", width: 1.4, align: "right" },
      { header: "Amount of perquisite chargeable to tax Col.(3) - Col.(4) (₹)", width: 1.5, align: "right" },
    ],
    rows: rows.map((r, i) => [String(i + 1), r.label, f(r.v), f(r.r), f(r.t)]),
    footRows: [
      ["21", "Total value of perquisites", f(total.v), f(total.r), f(total.t)],
      ["22", "Total value of profits in lieu of salary as per section 17(3)", "0.00", "0.00", "0.00"],
    ],
  });
  pdf.heading("9. Details of tax");
  pdf.table({
    columns: [{ header: "", width: 4 }, { header: "Amount (₹)", width: 1, align: "right" }],
    rows: [
      ["(a) Tax deducted from salary of the employee under section 192(1)", f(m.taxDeductedMinor)],
      ["(b) Tax paid by employer on behalf of the employee under section 192(1A)", "0.00"],
      ["(c) Total tax paid", f(m.taxDeductedMinor)],
      ["(d) Date of payment into Government treasury", "As per the challans in Form 16 Part A"],
    ],
  });
  pdf.heading("DECLARATION BY EMPLOYER / नियोक्ता की घोषणा");
  const who = m.responsible.name ? `I, ${m.responsible.name}${m.responsible.designation ? `, working as ${m.responsible.designation},` : ""}` : "I, the person responsible for deduction of tax,";
  pdf.paragraph(`${who} do hereby declare on behalf of ${m.employer.name} that the information given above is based on the books of account, documents and other relevant records or information available with us and the details of value of each such perquisite are in accordance with section 17 and rules framed thereunder and that such information is true and correct.`);
  if (m.responsible.name) {
    pdf.signatures([{
      caption: "Signature of the person responsible for deduction of tax",
      name: m.responsible.name,
      designation: m.responsible.designation ?? null,
      extra: [`Date: ${formatDateIst(m.generatedAt ?? new Date())}`],
    }]);
  } else {
    // No responsible officer configured: the statutory blanks, signed and completed by hand.
    pdf.space(18);
    for (const l of ["Signature of the person responsible for deduction of tax: ______________________", "Full name: ______________________", "Designation: ______________________", "Place: ______________________", `Date: ${formatDateIst(m.generatedAt ?? new Date())}`]) {
      pdf.paragraph(l, { gapAfter: 6 });
    }
  }
  return pdf.save();
}

export async function form12baPdfRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/statutory/form12ba/pdf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = z.object({ employeeId: z.string().uuid().optional(), fy: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.query ?? {});
    const employeeId = await scopeEmployeeId(ctx, q.employeeId, READER_STAFF_ROLES);
    let endYear: number;
    try { endYear = parseFy(q.fy).endYear; }
    catch (e) { throw new HttpError(400, "VALIDATION_FAILED", (e as Error).message); }

    let employer: Form16Deductor;
    try { employer = await resolveForm16Deductor(ctx.tenantId); }
    catch (err) {
      if (err instanceof DocumentNotIssuableError) throw new HttpError(422, "FORM12BA_EMPLOYER_NOT_CONFIGURED", err.message.replace("Form 16", "Form 12BA"));
      throw err;
    }

    let name = ""; let pan: string | null = null; let designation: string | null = null;
    try {
      const input = await fetchPayrollInput(ctx.tenantId, `${endYear}-03`);
      const emp = input.employees.find((e) => e.id === employeeId);
      name = emp?.fullName ?? ""; pan = emp?.pan ?? null;
      const extra = (emp ?? {}) as { designation?: unknown };
      designation = typeof extra.designation === "string" ? extra.designation : null;
    } catch (err) {
      if (err instanceof HrmsUnavailableError) throw new HttpError(502, "HRMS_UNAVAILABLE", "cannot generate Form 12BA: HRMS identity source unreachable");
      throw err;
    }

    const [dec] = await scopedRead((tx) => tx.select().from(taxDeclarations)
      .where(and(eq(taxDeclarations.tenantId, ctx.tenantId), eq(taxDeclarations.employeeId, employeeId), eq(taxDeclarations.fy, q.fy))).limit(1));
    const comps = await scopedRead((tx) => tx.select().from(perquisiteComponents)
      .where(and(eq(perquisiteComponents.tenantId, ctx.tenantId), eq(perquisiteComponents.employeeId, employeeId), eq(perquisiteComponents.fy, q.fy))));

    let salaryMinor = 0n; let tdsMinor = 0n; let assessmentYear = `${endYear}-${String((endYear + 1) % 100).padStart(2, "0")}`;
    try {
      const f16 = await buildForm16(ctx.tenantId, employeeId, q.fy);
      salaryMinor = BigInt(Math.round(f16.form16PartB.grossSalary * 100));
      tdsMinor = BigInt(Math.round(f16.form16PartB.totalTdsDeducted * 100));
      assessmentYear = f16.assessmentYear;
    } catch (err) {
      if (err instanceof HrmsUnavailableError) throw new HttpError(502, "HRMS_UNAVAILABLE", "cannot generate Form 12BA: HRMS identity source unreachable");
      throw err;
    }

    let responsible: { name: string | null; designation: string | null } = { name: null, designation: null };
    try {
      const lh = await loadLetterhead(ctx.tenantId);
      responsible = { name: lh?.ddoName ?? null, designation: lh?.signatoryTitle ?? null };
    } catch { /* no letterhead: the declaration is signed by hand */ }
    if (isRouteStaff(ctx, READER_STAFF_ROLES)) {
      await queue.publish(AUDIT_TOPIC, {
        messageId: randomUUID(), type: AUDIT_TOPIC, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
        payload: { service: "payroll", action: "view_form12ba", resourceType: "form12ba", resourceId: employeeId, outcome: "success", fy: q.fy, componentCount: comps.length, output: "pdf" },
      });
    }

    const pdf = await renderForm12baPdf({
      fy: q.fy, assessmentYear, employer,
      employee: { name, designation, pan },
      salaryIncomeMinor: salaryMinor,
      components: comps.map((c) => ({
        nature: c.nature, description: c.description, valueMinor: minorFromDb(c.valueByEmployerMinor),
        recoveredMinor: minorFromDb(c.amountRecoveredMinor), taxableMinor: minorFromDb(c.taxableValueMinor),
      })),
      aggregatePerquisiteMinor: dec ? minorFromDb(dec.perquisitesMinor) : 0n,
      taxDeductedMinor: tdsMinor,
      responsible,
    });
    return reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `attachment; filename="Form12BA_${q.fy}.pdf"`)
      .send(Buffer.from(pdf));
  });
}
