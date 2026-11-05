/**
 * UAT L2-N6 (+ review) -- producer/consumer contract for finance.gl.post { type: "inventory_movement" }.
 *
 * inventory-service posts every stock receipt / issue to finance.gl.post; finance-service had no branch for the type,
 * so each one was refused (JOURNAL_TOO_FEW_LINES) and dead-lettered (outbox e6932aac). This feeds the exact payload
 * inventory builds (gl-payload.ts, used by every emitGl call site) and the legacy wire shape still sitting in the DLQ
 * to the finance reader, for both accounting bases, and checks finance dispatches the type before its generic path.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { inventoryGlPostPayload } from "../../services/inventory-service/src/modules/movements/gl-payload.js";
import { parseInventoryMovement, accrualJournal, grnIdOf } from "../../services/finance-service/src/modules/gl/inventory-movement.js";
import { STORES_INVENTORY, STORES_CONSUMPTION, GRNI, STORES_SUSPENSE, grnBillHeadCode } from "../../services/finance-service/src/modules/gl/system-heads.js";
import { standardGlHeads, accrualStoresHeads } from "../../services/finance-service/src/modules/gl/standard-heads.js";

const ROOT = process.cwd();
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const balanced = (lines: Array<{ debitMinor: unknown; creditMinor: unknown }>) =>
  lines.reduce((s, l) => s + BigInt(String(l.debitMinor)) - BigInt(String(l.creditMinor)), 0n) === 0n;
const codes = (lines: Array<{ accountCode: string; debitMinor: unknown; creditMinor: unknown }>) => lines.map((l) => [l.accountCode, String(l.debitMinor), String(l.creditMinor)]);

describe("finance.gl.post inventory_movement contract (inventory-service -> finance-service)", () => {
  it("inventory sends every stock GL posting through the shared payload builder on INTEGRATION.glPost", () => {
    const src = read("services/inventory-service/src/modules/movements/consumer.ts");
    expect(src).toMatch(/topic:\s*INTEGRATION\.glPost[\s\S]*?payload:\s*inventoryGlPostPayload\(/);
    expect(src).not.toMatch(/type:\s*"inventory_movement"/);
    expect([...src.matchAll(/await emitGl\(/g)].length).toBeGreaterThanOrEqual(3); // manual receipt, issue, GRN receipt
    expect(src).toMatch(/refDoc: "GRN", refNo: p\.grnId/); // the GRN auto receipt is marked as such
    expect(read("services/inventory-service/src/topics.ts")).toMatch(/glPost:\s*"finance\.gl\.post"/);
  });

  it("finance dispatches inventory_movement (per accounting basis) before its generic journal path", () => {
    const src = read("services/finance-service/src/modules/gl/consumer.ts");
    const branch = src.indexOf("raw.type === INVENTORY_MOVEMENT_TYPE && !Array.isArray(raw.lines)");
    expect(branch).toBeGreaterThan(0);
    expect(branch).toBeLessThan(src.indexOf("const p = raw as StandardJournal;"));
    expect(src.slice(branch, branch + 4000)).toMatch(/accountingBasis/);
  });

  it("every producer payload parses into a stores memo row (the cash-basis record)", () => {
    const grnId = randomUUID();
    const m = parseInventoryMovement(inventoryGlPostPayload({ movementId: randomUUID(), kind: "receipt", totalMinor: 300100n, postingDate: "2026-11-04", storeId: randomUUID(), refDoc: "GRN", refNo: grnId }), "2099-01-01");
    expect(m).toMatchObject({ kind: "receipt", totalMinor: "300100", postingDate: "2026-11-04", refDoc: "GRN", refNo: grnId, legacy: false });
    expect(grnIdOf(m)).toBe(grnId);
  });

  it("accrual: a GRN receipt books Dr stores / Cr GRNI -- a liability, never the GRN bill (budget) head", () => {
    const p = inventoryGlPostPayload({ movementId: randomUUID(), kind: "receipt", totalMinor: 300100n, postingDate: "2026-11-04", refDoc: "GRN", refNo: randomUUID() });
    const j = accrualJournal(parseInventoryMovement(p, "2099-01-01"));
    expect(codes(j.lines)).toEqual([[STORES_INVENTORY, "300100", "0"], [GRNI, "0", "300100"]]);
    expect(GRNI).not.toBe(grnBillHeadCode());
    expect(balanced(j.lines)).toBe(true);
    expect(j.voucherNo).toBe("AUTO");
    expect(accrualJournal(parseInventoryMovement(p, "2099-01-01")).id).toBe(j.id); // deterministic
  });

  it("accrual: a manual receipt (no GRN) books Dr stores / Cr stores suspense; an issue books Dr 5300 + warning / Cr stores", () => {
    const manual = accrualJournal(parseInventoryMovement(inventoryGlPostPayload({ movementId: randomUUID(), kind: "receipt", totalMinor: 900n, postingDate: "2026-11-04", refDoc: "OPENING", refNo: "OB" }), "x"));
    expect(codes(manual.lines)).toEqual([[STORES_INVENTORY, "900", "0"], [STORES_SUSPENSE, "0", "900"]]);
    const issue = accrualJournal(parseInventoryMovement(inventoryGlPostPayload({ movementId: randomUUID(), kind: "issue", totalMinor: 5000n, postingDate: "2026-10-28" }), "x"));
    expect(codes(issue.lines)).toEqual([[STORES_CONSUMPTION, "5000", "0"], [STORES_INVENTORY, "0", "5000"]]);
    expect(issue.warnings).toEqual(["ISSUE_NO_CONSUMING_HEAD"]);
  });

  it("the legacy wire shape in the DLQ parses (cash: recorded on the re-drive day); accrual holds a legacy receipt", () => {
    const legacy = { kind: "receipt", type: "inventory_movement", movementId: "7c45e52f-7437-4fe7-9072-a7e8c94b7eab", totalMinor: "300100" };
    const m = parseInventoryMovement(legacy, "2026-11-10");
    expect(m).toMatchObject({ postingDate: "2026-11-10", legacy: true, refDoc: null });
    expect(() => accrualJournal(m)).toThrow(/INVENTORY_MOVEMENT_PAYLOAD: legacy receipt/);
  });

  it("the stores heads are accrual-only: not seeded for a (cash-basis) new tenant", () => {
    const standard = new Set(standardGlHeads().map((h) => h.code));
    const accrual = accrualStoresHeads().map((h) => h.code);
    expect(accrual).toEqual([STORES_INVENTORY, GRNI, STORES_SUSPENSE, STORES_CONSUMPTION]);
    for (const c of accrual) expect(standard.has(c)).toBe(false);
    expect(accrualStoresHeads().find((h) => h.code === GRNI)?.classification).toBe("liability");
  });

  it("money stays a paise decimal string on the wire", () => {
    const p = inventoryGlPostPayload({ movementId: randomUUID(), kind: "receipt", totalMinor: 9_007_199_254_740_993n, postingDate: "2026-11-04", refDoc: "GRN", refNo: randomUUID() });
    expect(p.totalMinor).toBe("9007199254740993");
    expect(accrualJournal(parseInventoryMovement(p, "2026-11-04")).lines[0]!.debitMinor).toBe("9007199254740993");
  });
});
