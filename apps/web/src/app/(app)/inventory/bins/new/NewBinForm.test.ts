import { describe, it, expect } from "vitest";
import { buildBinBody } from "./NewBinForm";

const STORE = "11111111-2222-4333-8444-555555555555";
const v = (o: Partial<Record<"storeId" | "code" | "aisle" | "rack" | "shelf" | "capacity", string>> = {}) => ({
  storeId: STORE, code: "A-01", aisle: "", rack: "", shelf: "", capacity: "", ...o,
});

describe("buildBinBody (GAP-INVENTORY-BINS-03)", () => {
  it("builds a minimal body and omits empty optionals", () => {
    expect(buildBinBody(v())).toEqual({ ok: true, body: { storeId: STORE, code: "A-01" } });
  });
  it("sends capacity as an integer", () => {
    expect(buildBinBody(v({ capacity: "40", aisle: "3" }))).toEqual({
      ok: true, body: { storeId: STORE, code: "A-01", aisle: "3", capacity: 40 },
    });
  });
  it("rejects a missing store, empty code, and bad capacity", () => {
    const r = buildBinBody(v({ storeId: "", code: " ", capacity: "0" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["capacity", "code", "storeId"]);
  });
});
