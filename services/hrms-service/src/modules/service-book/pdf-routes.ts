import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  OfficialPdf, formatDateIst, resolveDocIdentity, resolveSignatories, type DocIdentity, type Signatory,
} from "@civitasone/render/official";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as repo from "./repo.js";
import { assertCanReadEmployee, READER_ROLES } from "./routes.js";
import { getEmployeeDetail } from "../employee/queries.js";
// SEC-CRIT-001: reuse the existing HTML-escape helper (same service, already
// tested) instead of duplicating one -- see application-pdf.ts's own header
// comment for why every interpolated value must be escaped here too.
import { escapeHtml } from "../recruitment/application-pdf.js";

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

// GAP-HR-SERVICE-BOOK-01 / UAT ux-docs: GET .../service-book/pdf now returns a
// real PDF (the employee by name, entries with who recorded / attested them,
// dates in IST). The printable HTML view is kept at ?format=html.
const SERVICE_BOOK_TEMPLATE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Service Book — {{employeeName}}</title>
<style>
body{font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:24px;font-size:13px}
h1{text-align:center;font-size:16px}
table{width:100%;border-collapse:collapse;margin-top:16px}
th,td{border:1px solid #333;padding:6px 8px}
th{background:#f0f0f0}
.footer{margin-top:24px;font-size:11px;color:#666;text-align:center}
</style></head><body>
<h1>Service Book</h1>
<p><strong>Employee:</strong> {{employeeName}} ({{employeeNo}}) · {{designation}}</p>
<table><thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Document Ref</th><th>Attested</th></tr></thead>
<tbody>{{entryRows}}</tbody>
</table>
<div class="footer">Immutable service record</div>
</body></html>`;

export interface ServiceBookDocModel {
  employee: { name: string; employeeNo: string; designation: string | null; department: string | null; joiningDate: string | null; status: string | null };
  entries: Array<{ effectiveDate: string; entryType: string; description: string; documentRef: string | null; recordedBy: Signatory | null; attested: boolean; attestedBy: Signatory | null; attestedAt: string | null }>;
}

const humanType = (t: string) => t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const personLine = (s: Signatory | null) => (s ? [s.name, s.designation].filter(Boolean).join(", ") : "");

export async function renderServiceBookPdf(m: ServiceBookDocModel, issuer: DocIdentity, generatedAt?: Date): Promise<Uint8Array> {
  const pdf = await OfficialPdf.create({ title: `Service Book ${m.employee.name}`, lang: "bilingual", footerNote: `Service book · ${m.employee.employeeNo}`, ...(generatedAt ? { generatedAt } : {}) });
  pdf.letterhead(issuer);
  pdf.title("Service Book", "सेवा पुस्तिका");
  pdf.fields([
    { label: "Name", value: m.employee.name },
    { label: "Employee No", value: m.employee.employeeNo },
    { label: "Designation", value: m.employee.designation ?? "" },
    { label: "Department", value: m.employee.department ?? "" },
    { label: "Date of joining", value: formatDateIst(m.employee.joiningDate) },
    { label: "Status", value: (m.employee.status ?? "").replace(/_/g, " ") },
  ]);
  pdf.table({
    size: 8.5,
    columns: [
      { header: "S. No.", width: 0.6, align: "center" },
      { header: "Date", width: 1.2 },
      { header: "Entry", width: 1.3 },
      { header: "Particulars", width: 3.2 },
      { header: "Order / document", width: 1.4 },
      { header: "Recorded / attested by", width: 2.2 },
    ],
    rows: m.entries.map((e, i) => [
      String(i + 1), formatDateIst(e.effectiveDate), humanType(e.entryType), e.description, e.documentRef ?? "—",
      [personLine(e.recordedBy) && `Recorded: ${personLine(e.recordedBy)}`,
        e.attested ? `Attested: ${personLine(e.attestedBy) || "competent authority"}${e.attestedAt ? ` on ${formatDateIst(e.attestedAt)}` : ""}` : "Not yet attested"]
        .filter(Boolean).join("\n"),
    ]),
    emptyText: "No entries recorded.",
  });
  pdf.note("Each entry is attested by the competent authority in the service book of the employee.");
  return pdf.save();
}

export async function serviceBookPdfRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/employees/:id/service-book/pdf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const q = z.object({ format: z.enum(["pdf", "html"]).default("pdf") }).parse(req.query ?? {});
    // GAP-HR-SERVICE-BOOK-01: previously missing entirely -- any
    // READER_ROLES caller (incl. "manager") could pull ANY employee's
    // document just by id, unlike the JSON route (routes.ts), which already
    // scoped managers to their own department. Same helper, so the two
    // routes cannot drift again.
    await assertCanReadEmployee(ctx, id);
    const rows = await repo.listServiceBookEntries(ctx.tenantId, id);
    const emp = await getEmployeeDetail(id, ctx.tenantId).catch(() => null);
    const name = emp?.name ?? "";
    const employeeNo = emp?.employeeId ?? "";
    const designation = emp?.designation && emp.designation !== "—" ? emp.designation : null;
    const department = emp?.department && emp.department !== "—" ? emp.department : null;
    if (q.format === "html") {
      const entryRows = rows.length
        ? rows
            .map(
              (e) =>
                `<tr><td>${escapeHtml(formatDateIst(e.effectiveDate))}</td><td>${escapeHtml(e.entryType)}</td><td>${escapeHtml(e.description)}</td><td>${escapeHtml(e.documentRef ?? "—")}</td><td>${e.attested ? "Attested" : "Recorded"}</td></tr>`,
            )
            .join("")
        : "<tr><td colspan=\"5\">No entries recorded</td></tr>";
      const html = renderTemplate(SERVICE_BOOK_TEMPLATE, {
        employeeName: escapeHtml(name || "Employee"), employeeNo: escapeHtml(employeeNo), designation: escapeHtml(designation ?? ""), entryRows,
      });
      return reply.header("content-type", "text/html; charset=utf-8").send(html);
    }
    const people = await resolveSignatories(ctx.tenantId, rows.flatMap((r) => [r.recordedBy, r.attestedBy]));
    const get = (a: string | null) => (a ? people.get(a) ?? null : null);
    const issuer = await resolveDocIdentity(ctx.tenantId);
    const pdf = await renderServiceBookPdf({
      employee: { name, employeeNo, designation, department, joiningDate: emp?.joiningDate ?? null, status: emp?.status ?? null },
      entries: rows.map((r) => ({
        effectiveDate: String(r.effectiveDate), entryType: r.entryType, description: r.description, documentRef: r.documentRef ?? null,
        recordedBy: get(r.recordedBy), attested: r.attested, attestedBy: get(r.attestedBy ?? null),
        attestedAt: r.attestedAt instanceof Date ? r.attestedAt.toISOString() : (r.attestedAt as string | null) ?? null,
      })),
    }, issuer);
    const fname = `service-book-${(employeeNo || id.slice(0, 8)).replace(/[^\w.-]+/g, "_")}.pdf`;
    return reply.header("content-type", "application/pdf").header("content-disposition", `inline; filename="${fname}"`).send(Buffer.from(pdf));
  });
}
