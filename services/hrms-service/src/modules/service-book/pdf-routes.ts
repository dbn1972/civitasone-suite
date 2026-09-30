import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as repo from "./repo.js";
import { assertCanReadEmployee, READER_ROLES } from "./routes.js";
// SEC-CRIT-001: reuse the existing HTML-escape helper (same service, already
// tested) instead of duplicating one -- see application-pdf.ts's own header
// comment for why every interpolated value must be escaped here too.
import { escapeHtml } from "../recruitment/application-pdf.js";

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

// GAP-HR-SERVICE-BOOK-01: this is a printable HTML document (opened in a new
// tab so a browser's own "Print / Save as PDF" can produce a real PDF), not
// a server-rendered PDF file -- the route path and historical name are kept
// for URL compatibility, but nothing here claims a real PDF; see the web
// side's link label ("Print service book", not "Download PDF").
const SERVICE_BOOK_TEMPLATE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Service Book — {{employeeId}}</title>
<style>
body{font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:24px;font-size:13px}
h1{text-align:center;font-size:16px}
table{width:100%;border-collapse:collapse;margin-top:16px}
th,td{border:1px solid #333;padding:6px 8px}
th{background:#f0f0f0}
.footer{margin-top:24px;font-size:11px;color:#666;text-align:center}
</style></head><body>
<h1>Service Book (eHRMS)</h1>
<p><strong>Employee ID:</strong> {{employeeId}}</p>
<table><thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Document Ref</th><th>Attested</th></tr></thead>
<tbody>{{entryRows}}</tbody>
</table>
<div class="footer">Immutable service record — CivitasOne ERP</div>
</body></html>`;

export async function serviceBookPdfRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/employees/:id/service-book/pdf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    // GAP-HR-SERVICE-BOOK-01: previously missing entirely -- any
    // READER_ROLES caller (incl. "manager") could pull ANY employee's
    // document just by id, unlike the JSON route (routes.ts), which already
    // scoped managers to their own department. Same helper, so the two
    // routes cannot drift again.
    await assertCanReadEmployee(ctx, id);
    const rows = await repo.listServiceBookEntries(ctx.tenantId, id);
    const entryRows = rows.length
      ? rows
          .map(
            (e) =>
              `<tr><td>${escapeHtml(e.effectiveDate)}</td><td>${escapeHtml(e.entryType)}</td><td>${escapeHtml(e.description)}</td><td>${escapeHtml(e.documentRef ?? "—")}</td><td>${e.attested ? "Attested" : "Recorded"}</td></tr>`,
          )
          .join("")
      : "<tr><td colspan=\"5\">No entries recorded</td></tr>";
    const html = renderTemplate(SERVICE_BOOK_TEMPLATE, { employeeId: id, entryRows });
    return reply.header("content-type", "text/html; charset=utf-8").send(html);
  });
}
