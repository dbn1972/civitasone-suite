/**
 * UAT L2-N6 review: the finance accounting basis (gl.finance_settings.accounting_basis, migration 0160).
 *  - default cash; switching it is a second-admin change (isRelaxingControl);
 *  - the GL heads backfill adds the stores heads (1400 / GRNI 2080 / suspense 2085 / 5300) to ACCRUAL tenants only.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeSettings } from "../src/modules/approvals/schema.js";
import { SETTINGS_DEFAULTS, isRelaxingControl } from "../src/modules/approvals/domain.js";
import { loadSettingsTx } from "../src/modules/approvals/repo.js";
import { accrualStoresHeads, standardGlHeads } from "../src/modules/gl/standard-heads.js";
import { backfillStandardGlHeads } from "../scripts/backfill-standard-gl-heads.js";

const ACTOR = randomUUID();
const pg = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
afterAll(async () => { await pg.end({ timeout: 5 }); await sqlClient.end(); });
const STORES = accrualStoresHeads().map((h) => h.code).sort();
const codesOf = async (t: string) => (await scoped(t, (tx) => tx.select({ code: financeHeads.code }).from(financeHeads).where(eq(financeHeads.tenantId, t)))).map((r: { code: string }) => r.code);

describe("finance accounting basis", () => {
  it("defaults to cash: no settings row reads as cash", async () => {
    expect(SETTINGS_DEFAULTS.accountingBasis).toBe("cash");
    const t = randomUUID();
    expect((await scoped(t, (tx) => loadSettingsTx(tx, t))).accountingBasis).toBe("cash");
  });
  it("switching the basis (either way) needs a second admin; leaving it unchanged does not", () => {
    expect(isRelaxingControl(SETTINGS_DEFAULTS, { accountingBasis: "accrual" })).toBe(true);
    expect(isRelaxingControl({ ...SETTINGS_DEFAULTS, accountingBasis: "accrual" }, { accountingBasis: "cash" })).toBe(true);
    expect(isRelaxingControl(SETTINGS_DEFAULTS, { accountingBasis: "cash" })).toBe(false);
  });
  it("the database refuses an unknown basis", async () => {
    const t = randomUUID();
    await expect(scoped(t, (tx) => tx.insert(financeSettings).values({ tenantId: t, accountingBasis: "modified", updatedBy: ACTOR }))).rejects.toThrow();
  });
});

describe("backfill-standard-gl-heads per accounting basis", () => {
  it("a cash tenant gets the standard heads and none of the stores heads; an accrual tenant gets both", async () => {
    const cash = randomUUID(); const accrual = randomUUID();
    for (const t of [cash, accrual]) {
      await scoped(t, (tx) => tx.insert(financeHeads).values({ tenantId: t, code: "1100", name: "Bank", level: 1, classification: "asset", createdBy: ACTOR, updatedBy: ACTOR }));
    }
    await scoped(accrual, (tx) => tx.insert(financeSettings).values({ tenantId: accrual, accountingBasis: "accrual", updatedBy: ACTOR }));
    const dry = await backfillStandardGlHeads(pg, { dryRun: true, tenants: [cash, accrual] });
    expect(dry.map((p) => p.basis)).toEqual(["cash", "accrual"]);
    expect(dry[0]!.missing.map((h) => h.code).filter((c) => STORES.includes(c))).toEqual([]);
    expect(dry[1]!.missing.map((h) => h.code).filter((c) => STORES.includes(c)).sort()).toEqual(STORES);
    await backfillStandardGlHeads(pg, { dryRun: false, tenants: [cash, accrual] });
    const cashCodes = await codesOf(cash); const accrualCodes = await codesOf(accrual);
    for (const c of STORES) { expect(cashCodes).not.toContain(c); expect(accrualCodes).toContain(c); }
    for (const h of standardGlHeads()) { expect(cashCodes).toContain(h.code); }
    const again = await backfillStandardGlHeads(pg, { dryRun: false, tenants: [cash, accrual] });
    expect(again.flatMap((p) => p.inserted)).toEqual([]);
  });
});
