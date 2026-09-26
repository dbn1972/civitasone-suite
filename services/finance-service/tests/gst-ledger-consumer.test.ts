/**
 * Regression test: gl.finance_gst_ledger.created_by (migration 0079).
 *
 * Finance-service GST ledger functional sweep found the GST ledger could
 * never be populated, for two independent reasons:
 *
 *   Defect A — no producer: nothing outside this consumer's own test files
 *   ever publishes finance.gst.entry_record anywhere in the monorepo (grep
 *   confirmed). No existing finance-service module currently captures a
 *   taxable/tax breakdown on a bill or invoice at all (payments/*, the AP
 *   bill-creation path, has zero tax-related fields; revenue-billing/consumer.ts
 *   has none either) — org-structure/masters only store a GSTIN as static
 *   registration/master data, never a per-transaction split. So this isn't a
 *   forgotten publish() call at an existing site; it's a genuinely new
 *   integration point (capturing GST line items on a bill/invoice and
 *   splitting CGST/SGST/IGST by intra/inter-state supply) that doesn't exist
 *   yet anywhere in this codebase — a feature-sized gap, not fixed here.
 *
 *   Defect B — this consumer's own INSERT into gl.finance_gst_ledger
 *   referenced a created_by column that 0009_world_class_finance.sql never
 *   created. Confirmed pre-fix (5 correctly-rated CGST/SGST/IGST entries,
 *   real DB, no mocks): every one failed with `column "created_by" of
 *   relation "finance_gst_ledger" does not exist`. Fixed by migration 0079,
 *   which adds the column to match every sibling finance-service
 *   ledger/master table (gl.finance_journals, gl.finance_recurring_entries,
 *   gl.finance_fiscal_years, gl.finance_period_close,
 *   payments.finance_bank_accounts/finance_pao/finance_ddo) — all of which
 *   already carry the same single created_by audit column.
 *
 * This test proves Defect B's fix end-to-end and guards against both
 * regressing: real Postgres, real MemoryQueue with the same tenant-GUC
 * subscribe wrap worker.ts uses in production (so FORCE RLS reads/writes
 * succeed exactly like in prod) — no mocks. This is the only way to actually
 * catch a missing-column bug like this one:
 * services/finance-service/tests/consumers-coverage.test.ts's GST suite mocks
 * tx.execute() and therefore can never fail on a bad column reference, which
 * is exactly how this bug shipped unnoticed in the first place. Mirrors the
 * established pattern in nested-tx-deadlock.test.ts.
 *
 * Defect A has no producer to exercise, so it isn't (and can't be) covered
 * by a runtime test here; its absence is what the grep in this file's header
 * comment establishes.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { sql } from "drizzle-orm";
import { db } from "../src/shared/db.js";
import { registerGstConsumers } from "../src/modules/gst/consumer.js";

const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "bb000001-ec00-4000-8000-0000000000ff";

/** Mirrors worker.ts's global subscribe wrap: every handler runs under the
 *  message's tenant GUC so FORCE RLS reads/writes succeed, exactly like production. */
function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

function makeMsg(type: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0", payload,
  };
}

describe("gst consumer — gl.finance_gst_ledger created_by (real DB, no mocks)", () => {
  it("a valid CGST entry is written end-to-end with created_by = actorId", async () => {
    const invoiceNo = `INV/REGR/${randomUUID().slice(0, 8)}`;
    const q = tenantWrappedQueue();
    registerGstConsumers(q);
    await q.start();

    await q.publish("finance.gst.entry_record", makeMsg("finance.gst.entry_record", {
      id: randomUUID(), tenantId: TENANT, invoiceNo,
      invoiceDate: "2026-09-01", partyGstin: "07AAACR1234A1Z5",
      partyName: "Regression Test Pvt Ltd",
      gstType: "CGST", direction: "output", taxableMinor: 1_000_000,
      taxMinor: 90_000, ratePct: 9, hsnCode: "9954", period: "2026-09",
    }));

    // Pre-fix, the handler throws "column \"created_by\" does not exist" on
    // every attempt; MemoryQueue retries up to maxAttempts (5) before giving
    // up. drain() waits out that full retry+backoff cycle either way, so a
    // regression here fails on the row-existence assertion below, not a hang.
    await q.drain();
    await q.stop();

    const rows = await withTenantScope(db, TENANT, (tx: any) => tx.execute(sql`
      SELECT invoice_no, gst_type, direction, tax_minor, created_by
      FROM gl.finance_gst_ledger
      WHERE tenant_id = ${TENANT}::uuid AND invoice_no = ${invoiceNo}
    `));
    const arr = ((rows as { rows?: unknown[] }).rows ?? rows) as Array<Record<string, unknown>>;

    expect(arr).toHaveLength(1);
    expect(arr[0]!.gst_type).toBe("CGST");
    expect(arr[0]!.direction).toBe("output");
    expect(String(arr[0]!.tax_minor)).toBe("90000");
    expect(arr[0]!.created_by).toBe(ACTOR);
  });
});
