/**
 * GAP2-REVENUE-TRADE-LICENSES-10 / GAP2-PLATFORM-REVENUE-MONEY-01:
 * revenue.trade_licenses.fee_minor and .fee_paid_minor must be `bigint` minor
 * units, not `text` (CLAUDE.md §11). This is enforced by
 * migrations/0018_trade_licenses_money_bigint.sql, which also adds a `>= 0`
 * CHECK on each column.
 *
 * DB-backed: connects to the test Postgres named by DATABASE_URL and proves the
 * column type + constraint directly. FAILS on the pre-migration schema (text
 * columns, no CHECK). Also pins that revenue.waivers.amount_minor is bigint
 * (the finding's claim that it is text is refuted — it was bigint since 0005).
 */
import { describe, it, expect, afterAll } from "vitest";
import postgres from "postgres";

const URL = process.env.DATABASE_URL;
const sql = postgres(URL!, { max: 1 });

const TENANT = "0000aaaa-0000-0000-0000-00000000010a";
const ACTOR = "0000bbbb-0000-0000-0000-00000000010b";

afterAll(async () => {
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM revenue.trade_licenses WHERE tenant_id = ${TENANT}`;
  });
  await sql.end();
});

describe("trade_licenses money columns are bigint (GAP2-REVENUE-TRADE-LICENSES-10 / MONEY-01)", () => {
  it("fee_minor and fee_paid_minor have data_type bigint", async () => {
    const rows = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'revenue'
        AND table_name = 'trade_licenses'
        AND column_name IN ('fee_minor', 'fee_paid_minor')
      ORDER BY column_name
    `;
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]));
    expect(byName["fee_minor"]).toBe("bigint");
    expect(byName["fee_paid_minor"]).toBe("bigint");
  });

  it("revenue.waivers.amount_minor is bigint (finding REFUTED for waivers; drizzle drift corrected)", async () => {
    const rows = await sql`
      SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'revenue' AND table_name = 'waivers' AND column_name = 'amount_minor'
    `;
    expect(rows[0]?.data_type).toBe("bigint");
  });

  it("rejects a non-numeric fee (bigint type enforcement)", async () => {
    let failed = false;
    try {
      await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
        // Casting a non-numeric string to bigint fails at the DB — proving the
        // column can no longer hold arbitrary text as the old `text` column did.
        await tx`
          INSERT INTO revenue.trade_licenses
            (tenant_id, license_no, business_name, proprietor_name, address, business_type, fee_minor, created_by, updated_by)
          VALUES (${TENANT}, ${"NONNUM-" + Date.now()}, 'B', 'P', 'A', 'retail', ${"not-a-number"}, ${ACTOR}, ${ACTOR})
        `;
      });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  it("rejects a negative fee via the non-negative CHECK", async () => {
    let code: string | undefined;
    try {
      await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
        await tx`
          INSERT INTO revenue.trade_licenses
            (tenant_id, license_no, business_name, proprietor_name, address, business_type, fee_minor, created_by, updated_by)
          VALUES (${TENANT}, ${"NEG-" + Date.now()}, 'B', 'P', 'A', 'retail', ${-5}, ${ACTOR}, ${ACTOR})
        `;
      });
    } catch (err) {
      code = (err as { code?: string }).code;
    }
    // 23514 = check_violation
    expect(code).toBe("23514");
  });

  it("round-trips an integer fee as bigint", async () => {
    const n = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      const inserted = await tx`
        INSERT INTO revenue.trade_licenses
          (tenant_id, license_no, business_name, proprietor_name, address, business_type, fee_minor, fee_paid_minor, created_by, updated_by)
        VALUES (${TENANT}, ${"OK-" + Date.now()}, 'B', 'P', 'A', 'retail', ${1234500}, ${100}, ${ACTOR}, ${ACTOR})
        RETURNING fee_minor, fee_paid_minor
      `;
      return inserted[0];
    });
    // postgres.js returns bigint columns as strings by default; the value is exact.
    expect(String(n.fee_minor)).toBe("1234500");
    expect(String(n.fee_paid_minor)).toBe("100");
  });
});
