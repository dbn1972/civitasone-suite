/**
 * Migration 0111 backfill must work under FORCE RLS as the owner role (crm_svc,
 * no app.tenant_id GUC): a bare UPDATE matched 0 rows and silently backfilled
 * nothing. This runs the migration's backfill section as the service role.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { sqlClient } from "../src/shared/db.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const QID = randomUUID();
const OID = randomUUID();

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
const scoped = <T,>(fn: (tx: Tx) => Promise<T>): Promise<T> =>
  sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;

function backfillSql(): string {
  const full = readFileSync(new URL("../migrations/0111_quotation_tax_gst_multicurrency.sql", import.meta.url), "utf8");
  const i = full.indexOf("ALTER TABLE crm.quotations NO FORCE ROW LEVEL SECURITY");
  expect(i).toBeGreaterThan(0);
  return full.slice(i);
}

async function readRow() {
  return scoped(async (tx) =>
    (await tx<Array<{ tax: string; qGrand: string; oGrand: string }>>`
      SELECT q.tax_minor::text AS tax, q.grand_total_minor::text AS "qGrand", o.grand_total_minor::text AS "oGrand"
      FROM crm.quotations q JOIN crm.orders o ON o.quotation_id = q.id WHERE q.id = ${QID}`)[0],
  );
}

describe("0111 backfill under FORCE RLS as crm_svc", () => {
  beforeAll(async () => {
    await scoped(async (tx) => {
      await tx`INSERT INTO crm.quotations (id, tenant_id, quote_ref, total_minor, grand_total_minor, tax_minor)
               VALUES (${QID}, ${TENANT}, 'Q-0111', 100000, 0, 0)`;
      await tx`INSERT INTO crm.quotation_line_items (tenant_id, quotation_id, description, quantity, unit_price_minor, tax_rate_bps, line_total_minor, created_by)
               VALUES (${TENANT}, ${QID}, 'x', 1, 100000, 1800, 100000, ${ACTOR})`;
      await tx`INSERT INTO crm.orders (id, tenant_id, quotation_id, quotation_version, order_ref, total_minor, grand_total_minor, created_by, updated_by)
               VALUES (${OID}, ${TENANT}, ${QID}, 1, 'O-0111', 100000, 0, ${ACTOR}, ${ACTOR})`;
    });
  });
  afterAll(async () => {
    await scoped(async (tx) => {
      await tx`DELETE FROM crm.orders WHERE tenant_id = ${TENANT}`;
      await tx`DELETE FROM crm.quotation_line_items WHERE tenant_id = ${TENANT}`;
      await tx`DELETE FROM crm.quotations WHERE tenant_id = ${TENANT}`;
    });
    await sqlClient.end();
  });

  it("backfills tax, grand total and order grand total, is idempotent, and restores FORCE", async () => {
    expect(await readRow()).toEqual({ tax: "0", qGrand: "0", oGrand: "0" });

    await sqlClient.unsafe(backfillSql());
    expect(await readRow()).toEqual({ tax: "18000", qGrand: "118000", oGrand: "118000" });

    await sqlClient.unsafe(backfillSql()); // idempotent re-run
    expect(await readRow()).toEqual({ tax: "18000", qGrand: "118000", oGrand: "118000" });

    const flags = await sqlClient<Array<{ relname: string; f: boolean }>>`
      SELECT relname, relforcerowsecurity AS f FROM pg_class
      WHERE oid IN ('crm.quotations'::regclass, 'crm.orders'::regclass, 'crm.quotation_line_items'::regclass)`;
    expect(flags).toHaveLength(3);
    expect(flags.every((r) => r.f)).toBe(true);
  });
});
