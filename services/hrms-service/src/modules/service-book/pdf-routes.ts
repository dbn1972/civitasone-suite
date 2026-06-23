import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as repo from "./repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const READER_ROLES = [...HR_ROLES, "manager"];

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

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
<table><thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Document Ref</th></tr></thead>
<tbody>{{entryRows}}</tbody>
</table>
<div class="footer">Immutable service record — CivitasOne ERP</div>
</body></html>`;

export async function serviceBookPdfRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/employees/:id/service-book/pdf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const rows = await repo.listServiceBookEntries(ctx.tenantId, id);
    const entryRows = rows.length
      ? rows.map((e) => `<tr><td>${e.effectiveDate}</td><td>${e.entryType}</td><td>${e.description}</td><td>${e.documentRef ?? "—"}</td></tr>`).join("")
      : "<tr><td colspan=\"4\">No entries recorded</td></tr>";
    const html = renderTemplate(SERVICE_BOOK_TEMPLATE, { employeeId: id, entryRows });
    return reply.header("content-type", "text/html; charset=utf-8").send(html);
  });
}
