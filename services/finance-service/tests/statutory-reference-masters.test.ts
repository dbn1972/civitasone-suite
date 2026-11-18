/**
 * Statutory reference masters (migration 0175): real Postgres. Tables are GLOBAL (no tenant_id, no RLS), seeded,
 * and have no consumer yet.
 */
import { describe, it, expect, afterAll } from "vitest";
import { sqlClient } from "../src/shared/db.js";

afterAll(async () => { await sqlClient.end(); });

describe("statutory reference masters (0175)", () => {
  it("seeds all state codes incl. the named ones", async () => {
    const r = await sqlClient`SELECT code, name FROM gl.finance_gst_state_codes ORDER BY code`;
    const m = new Map(r.map((x) => [x.code as string, x.name as string]));
    expect(r.length).toBe(40);
    expect(m.get("07")).toBe("Delhi");
    expect(m.get("27")).toBe("Maharashtra");
    expect(m.get("29")).toBe("Karnataka");
    expect(m.get("33")).toBe("Tamil Nadu");
    expect(m.get("37")).toBe("Andhra Pradesh");
    expect(m.get("38")).toBe("Ladakh");
  });
  it("rate master is effective-dated: 12/28 closed, 40 open", async () => {
    const r = await sqlClient`SELECT rate_pct::float AS r, effective_to FROM gl.finance_gst_rate_master WHERE hsn_prefix = ''`;
    const open = r.filter((x) => x.effective_to === null).map((x) => x.r).sort((a, b) => a - b);
    expect(open).toEqual([0, 0.25, 3, 5, 18, 40]);
    expect(r.length).toBe(8);
  });
  it("HSN/SAC master seeded with generated digit count", async () => {
    const r = await sqlClient`SELECT count(*)::int AS n, bool_and(digits = length(code)) AS ok FROM gl.finance_hsn_sac_master`;
    expect(r[0]!.n).toBe(21);
    expect(r[0]!.ok).toBe(true);
  });
  it("tables are global: no tenant_id column, no RLS", async () => {
    const cols = await sqlClient`SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema='gl' AND column_name='tenant_id'
        AND table_name IN ('finance_gst_rate_master','finance_hsn_sac_master','finance_gst_state_codes')`;
    expect(cols[0]!.n).toBe(0);
    const rls = await sqlClient`SELECT count(*)::int AS n FROM pg_class WHERE relrowsecurity
      AND relname IN ('finance_gst_rate_master','finance_hsn_sac_master','finance_gst_state_codes')`;
    expect(rls[0]!.n).toBe(0);
  });
});
