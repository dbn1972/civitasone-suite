import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "../gl/repo.js";

const READER_ROLES = ["finance_officer", "finance_admin", "super_admin", "audit_officer"];

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

const VOUCHER_TEMPLATE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Payment Voucher {{voucherNo}}</title>
<style>
body{font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:24px}
h1{text-align:center;font-size:18px;margin:0}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:13px;margin:16px 0}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:12px}
th,td{border:1px solid #ccc;padding:6px 8px}
th{background:#f5f5f5}
.amount{text-align:right}
.footer{margin-top:24px;font-size:11px;color:#666;text-align:center}
</style></head><body>
<h1>{{orgName}}</h1>
<p style="text-align:center">Payment Voucher / Journal Entry</p>
<dl class="meta">
<dt>Voucher No</dt><dd>{{voucherNo}}</dd>
<dt>Date</dt><dd>{{postingDate}}</dd>
<dt>Type</dt><dd>{{type}}</dd>
<dt>Status</dt><dd>{{status}}</dd>
</dl>
<table><thead><tr><th>Account</th><th class="amount">Debit (₹)</th><th class="amount">Credit (₹)</th><th>Narration</th></tr></thead>
<tbody>{{lineRows}}</tbody>
<tfoot><tr><th>Total</th><th class="amount">{{totalDebit}}</th><th class="amount">{{totalCredit}}</th><th></th></tr></tfoot>
</table>
<div class="footer">System-generated voucher — print for records</div>
</body></html>`;

function fmt(minor: number): string {
  return (minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 });
}

export async function voucherPrintRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/finance/journals/:id/pdf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const journal = await repo.findJournalById(id);
    if (!journal || journal.tenantId !== ctx.tenantId) {
      throw new HttpError(404, "NOT_FOUND", "journal not found");
    }
    const lines = journal.lines ?? [];
    let totalDebit = 0;
    let totalCredit = 0;
    const lineRows = lines.map((l) => {
      const dr = Number(l.debitMinor);
      const cr = Number(l.creditMinor);
      totalDebit += dr;
      totalCredit += cr;
      return `<tr><td>${l.accountCode}</td><td class="amount">${fmt(dr)}</td><td class="amount">${fmt(cr)}</td><td></td></tr>`;
    }).join("");
    const html = renderTemplate(VOUCHER_TEMPLATE, {
      orgName: "CivitasOne Government ERP",
      voucherNo: journal.voucherNo,
      postingDate: String(journal.postingDate),
      type: journal.type ?? "journal",
      status: journal.status ?? "posted",
      lineRows,
      totalDebit: fmt(totalDebit),
      totalCredit: fmt(totalCredit),
    });
    return reply.header("content-type", "text/html; charset=utf-8").send(html);
  });

  app.get("/v1/finance/journals/:id/download", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const journal = await repo.findJournalById(id);
    if (!journal || journal.tenantId !== ctx.tenantId) {
      throw new HttpError(404, "NOT_FOUND", "journal not found");
    }
    const lines = journal.lines ?? [];
    let totalDebit = 0;
    let totalCredit = 0;
    const lineRows = lines.map((l) => {
      const dr = Number(l.debitMinor);
      const cr = Number(l.creditMinor);
      totalDebit += dr;
      totalCredit += cr;
      return `<tr><td>${l.accountCode}</td><td class="amount">${fmt(dr)}</td><td class="amount">${fmt(cr)}</td><td></td></tr>`;
    }).join("");
    const html = renderTemplate(VOUCHER_TEMPLATE, {
      orgName: "CivitasOne Government ERP",
      voucherNo: journal.voucherNo,
      postingDate: String(journal.postingDate),
      type: journal.type ?? "journal",
      status: journal.status ?? "posted",
      lineRows,
      totalDebit: fmt(totalDebit),
      totalCredit: fmt(totalCredit),
    });
    return reply
      .header("content-type", "text/html; charset=utf-8")
      .header("content-disposition", `attachment; filename="voucher-${journal.voucherNo}.html"`)
      .send(html);
  });
}
