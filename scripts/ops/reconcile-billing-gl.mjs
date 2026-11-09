#!/usr/bin/env node
/**
 * reconcile-billing-gl.mjs -- find billing invoices whose GL journals never reached finance and re-emit the missing
 * billing.invoice.issued / billing.invoice.paid events (B22 D4).
 *
 * Why it exists: before migration 0156 (31 Oct 2026) finance refused the billing_cash_receipt journal type, so the
 * billing.invoice.paid event of every invoice paid until then dead-lettered and was never re-driven; a bill paid
 * through the legacy PATCH /pay path emitted no event at all. Finance has since been fixed, but those receipts stay missing.
 *
 * What it checks (read-only), per tenant:
 *   issued/partially_paid/paid/overdue invoice  -> posted journal  voucher_no = INV/<first 8 of id, upper>
 *   paid invoice                                -> posted journal  voucher_no = RCPT/<first 8 of id, upper>
 * and, with --apply, inserts the missing events into the billing outbox (_outbox.messages) so the normal relay
 * publishes them. Re-driving is idempotent: finance derives the journal id from the invoice id
 * (deterministicId("billing_invoice_issued:<id>") / ("billing_invoice_paid:<id>")), so an event that WAS processed
 * after all posts nothing a second time; the AR sub-ledger sync is idempotent per invoice too.
 *
 * Usage:
 *   BILLING_DATABASE_URL=postgres://... FINANCE_DATABASE_URL=postgres://... \
 *     node scripts/ops/reconcile-billing-gl.mjs [--tenant <uuid>] [--post-date YYYY-MM-DD] [--apply] [--requeue]
 *   Default is a dry run: it prints the gaps and writes nothing.
 *   --requeue     queue again an event an earlier --apply already queued (marker: correlation id reconcile-b22-<id8>).
 *   --post-date   book the re-driven journals on this date (default: the invoice's own issued / paid date in IST).
 *                 Use it if that period has since been closed (finance refuses a posting into a closed period).
 *   BILLING_DATABASE_URL must be able to read invoices.billing_invoices across tenants and (with --apply) insert into
 *   _outbox.messages; FINANCE_DATABASE_URL must be able to read gl.finance_journals across tenants (an admin /
 *   platform-bypass role). Neither URL is printed. Do NOT point this at a database you have not meant to change
 *   when passing --apply.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(ROOT, "packages/db/package.json"));
const postgres = require("postgres");

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const apply = flag("--apply");
const tenantFilter = opt("--tenant");
const postDate = opt("--post-date");
if (postDate && !/^\d{4}-\d{2}-\d{2}$/.test(postDate)) { console.error("--post-date must be YYYY-MM-DD"); process.exit(2); }
if (tenantFilter && !/^[0-9a-f-]{36}$/i.test(tenantFilter)) { console.error("--tenant must be a uuid"); process.exit(2); }
const billingUrl = process.env.BILLING_DATABASE_URL;
const financeUrl = process.env.FINANCE_DATABASE_URL;
if (!billingUrl || !financeUrl) { console.error("set BILLING_DATABASE_URL and FINANCE_DATABASE_URL"); process.exit(2); }

const billing = postgres(billingUrl, { max: 1, onnotice: () => {} });
const finance = postgres(financeUrl, { max: 1, onnotice: () => {} });
const istDate = (d) => (d ? new Date(new Date(d).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10) : null);
const id8 = (id) => id.replace(/-/g, "").slice(0, 8).toUpperCase();
// voucher numbers use the first 8 characters of the uuid string (dashes are past character 8)
const v8 = (id) => id.slice(0, 8).toUpperCase();

try {
  const invoices = await billing`
    SELECT id, tenant_id, invoice_number, status, total_minor::text AS total_minor, issued_at, paid_at,
           COALESCE(issued_by, updated_by) AS actor
      FROM invoices.billing_invoices
     WHERE status IN ('issued','partially_paid','paid','overdue')
       ${tenantFilter ? billing`AND tenant_id = ${tenantFilter}::uuid` : billing``}
     ORDER BY tenant_id, invoice_number NULLS LAST`;
  const vouchers = new Set((await finance`
    SELECT voucher_no FROM gl.finance_journals
     WHERE status IN ('posted','reversed') AND (voucher_no LIKE 'INV/%' OR voucher_no LIKE 'RCPT/%')
       ${tenantFilter ? finance`AND tenant_id = ${tenantFilter}::uuid` : finance``}`).map((r) => r.voucher_no));

  // Idempotent: an event this script already queued (marked by its correlation id) is not queued again, whether the
  // relay has published it yet or not. --requeue ignores the marker (use only if finance failed to post a queued event).
  const queued = new Set((await billing`
    SELECT topic || ':' || (payload->>'invoiceId') AS k FROM _outbox.messages WHERE correlation_id LIKE 'reconcile-b22-%'`).map((r) => r.k));
  const requeue = flag("--requeue");
  const gaps = [];
  for (const inv of invoices) {
    if (!vouchers.has(`INV/${v8(inv.id)}`) && inv.issued_at) {
      gaps.push({ kind: "issued", inv, topic: "billing.invoice.issued", payload: { invoiceId: inv.id, totalMinor: inv.total_minor, issuedDate: postDate ?? istDate(inv.issued_at) } });
    }
    if (inv.status === "paid" && !vouchers.has(`RCPT/${v8(inv.id)}`)) {
      gaps.push({ kind: "paid", inv, topic: "billing.invoice.paid", payload: { invoiceId: inv.id, totalMinor: inv.total_minor, paidDate: postDate ?? istDate(inv.paid_at) } });
    }
  }

  const already = requeue ? [] : gaps.filter((g) => queued.has(`${g.topic}:${g.inv.id}`));
  if (already.length) { for (const g of already) gaps.splice(gaps.indexOf(g), 1); console.log(`${already.length} event(s) already queued by an earlier run: skipped`); }
  console.log(`${invoices.length} issued/paid invoices checked, ${gaps.length} missing journal event(s) to queue${apply ? "" : " (dry run: nothing written)"}`);
  for (const g of gaps) console.log(`  ${g.kind.padEnd(6)} ${g.inv.invoice_number ?? g.inv.id}  tenant ${g.inv.tenant_id}  total_minor ${g.inv.total_minor}  ->  ${g.topic} ${JSON.stringify(g.payload)}`);

  if (apply && gaps.length) {
    await billing.begin(async (tx) => {
      for (const g of gaps) {
        await tx`SELECT set_config('app.tenant_id', ${g.inv.tenant_id}, true)`;
        await tx`
          INSERT INTO _outbox.messages (id, topic, event_type, tenant_id, actor_id, correlation_id, payload)
          VALUES (${randomUUID()}::uuid, ${g.topic}, ${g.topic}, ${g.inv.tenant_id}::uuid, ${g.inv.actor}::uuid, ${"reconcile-b22-" + id8(g.inv.id)}, ${tx.json(g.payload)})`;
      }
    });
    console.log(`queued ${gaps.length} event(s) in the billing outbox; the relay publishes them and finance posts the journals`);
  }
  process.exitCode = gaps.length && !apply ? 1 : 0;
} finally {
  await billing.end({ timeout: 5 });
  await finance.end({ timeout: 5 });
}
