import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../../shared/context.js";
import { sqlClient } from "../../../shared/db.js";
import * as queries from "../queries.js";

const READER_ROLES = ["estab_officer", "estab_admin", "estab_deputy_secretary", "super_admin", "audit_officer"];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString("en-IN"); } catch { return iso; }
}

export async function noteSheetPrintRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/estab/files/:id/note-sheet/pdf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const file = await queries.getFileDetail(ctx.tenantId, id);
    if (!file) throw new HttpError(404, "NOT_FOUND", "file not found");

    // Tenant organisation name for the header — NOT a hardcoded sovereign/owner
    // string (editions include Govt, PSU, NGO, private). Resolved defensively
    // from the shared tenant registry if present in this service DB.
    let orgName = "";
    try {
      const rows = await sqlClient`SELECT name FROM public.tenants WHERE id = ${ctx.tenantId} LIMIT 1`;
      orgName = (rows as unknown as Array<{ name?: string }>)[0]?.name ?? "";
    } catch {
      /* tenant registry not replicated in this DB — fall back below */
    }
    const headerOrg = orgName || file.dept || "Office Note Sheet";

    const rows = file.noteSheets.map((n, i) => {
      const ext = n as { noteType?: string; noteStatus?: string; eSigned?: boolean; signatureRef?: string };
      const bg = ext.noteType === "green" || ext.eSigned ? "#f0fdf4" : "#fefce8";
      const sign = ext.signatureRef ? `<br/><small>DSC: ${esc(ext.signatureRef)}</small>` : "";
      return `<tr style="background:${bg}"><td>${i + 1}</td><td>${esc(n.author)}</td><td>${esc(n.content)}${sign}</td><td>${esc(ext.noteType ?? "yellow")}</td><td>${esc(ext.noteStatus ?? "")}</td></tr>`;
    }).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Note Sheet ${esc(file.fileNo)}</title>
<style>
body{font-family:Arial,sans-serif;max-width:900px;margin:0 auto;padding:24px}
h1{text-align:center;font-size:18px}
.meta{margin:16px 0;font-size:13px}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{border:1px solid #ccc;padding:8px;text-align:left}
th{background:#f5f5f5}
.footer{margin-top:24px;font-size:11px;color:#666;text-align:center}
</style></head><body>
<h1>${esc(headerOrg)} — Note Sheet</h1>
<div class="meta">
  <div><b>File No:</b> ${esc(file.fileNo)}</div>
  <div><b>Subject:</b> ${esc(file.subject)}</div>
  <div><b>Department:</b> ${esc(file.dept)}</div>
  ${file.dakNo ? `<div><b>DAK No:</b> ${esc(file.dakNo)}</div>` : ""}
  ${file.dueBy ? `<div><b>SLA Due:</b> ${fmtDate(file.dueBy)}</div>` : ""}
</div>
<table><thead><tr><th>#</th><th>Officer</th><th>Note</th><th>Type</th><th>Status</th></tr></thead>
<tbody>${rows || "<tr><td colspan='5'>No notes</td></tr>"}</tbody></table>
<div class="footer">System-generated note sheet — print for official record</div>
</body></html>`;

    return reply.header("content-type", "text/html; charset=utf-8").send(html);
  });
}
