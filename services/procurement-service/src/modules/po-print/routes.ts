import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as queries from "../po/queries.js";

const READER_ROLES = ["procurement_officer", "procurement_admin", "super_admin", "finance_officer", "audit_officer"];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// itemRows is pre-built trusted HTML; everything else is escaped.
const RAW_KEYS = new Set(["itemRows"]);

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = vars[key] ?? "";
    return RAW_KEYS.has(key) ? v : escapeHtml(v);
  });
}

const PO_TEMPLATE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Purchase Order {{poNo}}</title>
<style>
body{font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:24px;font-size:13px}
h1{text-align:center;font-size:18px}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;margin:16px 0}
table{width:100%;border-collapse:collapse;margin-top:12px}
th,td{border:1px solid #ccc;padding:6px 8px}
th{background:#f5f5f5}
.amount{text-align:right}
</style></head><body>
<h1>Purchase Order</h1>
<dl class="meta">
<dt>PO Number</dt><dd>{{poNo}}</dd>
<dt>Vendor</dt><dd>{{vendorName}}</dd>
<dt>Date</dt><dd>{{orderDate}}</dd>
<dt>Status</dt><dd>{{status}}</dd>
<dt>Total</dt><dd>₹ {{totalAmount}}</dd>
</dl>
<table><thead><tr><th>Item</th><th>Qty</th><th class="amount">Rate (₹)</th><th class="amount">Amount (₹)</th></tr></thead>
<tbody>{{itemRows}}</tbody>
</table>
<p style="margin-top:24px;font-size:11px;color:#666;text-align:center">GFR-compliant PO — system generated</p>
</body></html>`;

export async function poPrintRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/procurement/pos/:id/pdf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const po = await queries.getPo(id, ctx.tenantId);
    if (!po) throw new HttpError(404, "NOT_FOUND", "PO not found");
    const items = (po.items as Array<{ description?: string; qty?: number; unitPriceMinor?: number; amountMinor?: number }>) ?? [];
    const itemRows = items.map((i) => {
      const amt = ((i.amountMinor ?? 0) / 100).toFixed(2);
      const rate = ((i.unitPriceMinor ?? 0) / 100).toFixed(2);
      return `<tr><td>${escapeHtml(String(i.description ?? "Item"))}</td><td>${i.qty ?? 1}</td><td class="amount">${rate}</td><td class="amount">${amt}</td></tr>`;
    }).join("") || "<tr><td colspan=\"4\">No line items</td></tr>";
    const html = renderTemplate(PO_TEMPLATE, {
      poNo: String(po.poNo ?? id.slice(0, 8)),
      vendorName: String(po.vendorName ?? po.vendorId ?? "Vendor"),
      orderDate: String(po.orderDate ?? new Date().toISOString().slice(0, 10)),
      status: String(po.status ?? "draft"),
      totalAmount: ((Number(po.totalMinor ?? 0)) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 }),
      itemRows,
    });
    return reply.header("content-type", "text/html; charset=utf-8").send(html);
  });

  app.get("/v1/procurement/pos/:id/download", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const po = await queries.getPo(id, ctx.tenantId);
    if (!po) throw new HttpError(404, "NOT_FOUND", "PO not found");
    const items = (po.items as Array<{ description?: string; qty?: number; unitPriceMinor?: number; amountMinor?: number }>) ?? [];
    const itemRows = items.map((i) => {
      const amt = ((i.amountMinor ?? 0) / 100).toFixed(2);
      const rate = ((i.unitPriceMinor ?? 0) / 100).toFixed(2);
      return `<tr><td>${escapeHtml(String(i.description ?? "Item"))}</td><td>${i.qty ?? 1}</td><td class="amount">${rate}</td><td class="amount">${amt}</td></tr>`;
    }).join("") || "<tr><td colspan=\"4\">No line items</td></tr>";
    const poNo = String(po.poNo ?? id.slice(0, 8));
    const html = renderTemplate(PO_TEMPLATE, {
      poNo,
      vendorName: String(po.vendorName ?? po.vendorId ?? "Vendor"),
      orderDate: String(po.orderDate ?? new Date().toISOString().slice(0, 10)),
      status: String(po.status ?? "draft"),
      totalAmount: ((Number(po.totalMinor ?? 0)) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 }),
      itemRows,
    });
    return reply
      .header("content-type", "text/html; charset=utf-8")
      .header("content-disposition", `attachment; filename="PO-${poNo}.html"`)
      .send(html);
  });
}
