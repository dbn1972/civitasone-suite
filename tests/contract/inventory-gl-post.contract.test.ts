/**
 * UAT L2-N6 -- producer/consumer contract for finance.gl.post { type: "inventory_movement" }.
 *
 * inventory-service posts the stock value of every receipt / issue to finance.gl.post; finance-service had no branch
 * for the type, so each one was refused (JOURNAL_TOO_FEW_LINES) and dead-lettered (outbox e6932aac). This feeds the
 * exact payload inventory builds (gl-payload.ts, used by every emitGl call site) to the finance journal builder, and
 * the legacy wire shape still sitting in the DLQ, and checks finance dispatches the type before its generic path.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { inventoryGlPostPayload } from "../../services/inventory-service/src/modules/movements/gl-payload.js";
import { inventoryMovementJournal } from "../../services/finance-service/src/modules/gl/inventory-movement.js";
import { STORES_INVENTORY, STORES_CONSUMPTION, grnBillHeadCode } from "../../services/finance-service/src/modules/gl/system-heads.js";
import { standardGlHeads } from "../../services/finance-service/src/modules/gl/standard-heads.js";

const ROOT = process.cwd();
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const balanced = (lines: Array<{ debitMinor: unknown; creditMinor: unknown }>) =>
  lines.reduce((s, l) => s + BigInt(String(l.debitMinor)) - BigInt(String(l.creditMinor)), 0n) === 0n;

describe("finance.gl.post inventory_movement contract (inventory-service -> finance-service)", () => {
  it("inventory sends every stock GL posting through the shared payload builder on INTEGRATION.glPost", () => {
    const src = read("services/inventory-service/src/modules/movements/consumer.ts");
    expect(src).toMatch(/topic:\s*INTEGRATION\.glPost[\s\S]*?payload:\s*inventoryGlPostPayload\(/);
    expect(src).not.toMatch(/type:\s*"inventory_movement"/); // no hand-built copy of the payload
    expect([...src.matchAll(/await emitGl\(/g)].length).toBeGreaterThanOrEqual(3); // manual receipt, issue, GRN receipt
    expect(read("services/inventory-service/src/topics.ts")).toMatch(/glPost:\s*"finance\.gl\.post"/);
  });

  it("finance dispatches inventory_movement before its generic journal path", () => {
    const src = read("services/finance-service/src/modules/gl/consumer.ts");
    const branch = src.indexOf("raw.type === INVENTORY_MOVEMENT_TYPE");
    expect(branch).toBeGreaterThan(0);
    expect(branch).toBeLessThan(src.indexOf("const p = raw as StandardJournal;"));
  });

  it("a GRN stock receipt books Dr stores / Cr the GRN bill head (GRN clearing), balanced, on its date", () => {
    const movementId = randomUUID(); const grnId = randomUUID();
    const payload = inventoryGlPostPayload({ movementId, kind: "receipt", totalMinor: 300100n, postingDate: "2026-11-04", storeId: randomUUID(), refDoc: "GRN", refNo: grnId });
    const j = inventoryMovementJournal(payload, "2099-01-01");
    expect(j.postingDate).toBe("2026-11-04");
    expect(j.lines.map((l) => [l.accountCode, l.debitMinor, l.creditMinor])).toEqual([[STORES_INVENTORY, "300100", "0"], [grnBillHeadCode(), "0", "300100"]]);
    expect(balanced(j.lines)).toBe(true);
    expect(j.sourceRef).toBe(`inventory_movement:${movementId}`);
    expect(inventoryMovementJournal(payload, "2099-01-01").id).toBe(j.id); // deterministic: a redelivery is the same journal
  });

  it("a stores issue books Dr stores consumed / Cr stores", () => {
    const j = inventoryMovementJournal(inventoryGlPostPayload({ movementId: randomUUID(), kind: "issue", totalMinor: 5000n, postingDate: "2026-10-28" }), "2099-01-01");
    expect(j.lines.map((l) => [l.accountCode, l.debitMinor, l.creditMinor])).toEqual([[STORES_CONSUMPTION, "5000", "0"], [STORES_INVENTORY, "0", "5000"]]);
  });

  it("the legacy wire shape in the DLQ (no postingDate / refs) still builds, dated on the re-drive day", () => {
    const legacy = { kind: "receipt", type: "inventory_movement", movementId: "7c45e52f-7437-4fe7-9072-a7e8c94b7eab", totalMinor: "300100" };
    const j = inventoryMovementJournal(legacy, "2026-11-10");
    expect(j.postingDate).toBe("2026-11-10");
    expect(balanced(j.lines)).toBe(true);
  });

  it("every head the journal posts to is a standard GL head (seeded for new tenants, backfilled for old ones)", () => {
    const codes = new Set(standardGlHeads().map((h) => h.code));
    for (const c of [STORES_INVENTORY, STORES_CONSUMPTION, grnBillHeadCode()]) expect(codes.has(c)).toBe(true);
  });

  it("money stays a paise decimal string on the wire", () => {
    const p = inventoryGlPostPayload({ movementId: randomUUID(), kind: "receipt", totalMinor: 9_007_199_254_740_993n, postingDate: "2026-11-04" });
    expect(p.totalMinor).toBe("9007199254740993");
    expect(inventoryMovementJournal(p, "2026-11-04").lines[0]!.debitMinor).toBe("9007199254740993");
  });
});
