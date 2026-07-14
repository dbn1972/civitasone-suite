/**
 * EPIC-3 T3.1: tenant federation chain formatting. The recursive resolution is
 * done by SECURITY DEFINER SQL functions (verified live); this pins the pure
 * TS-side chain rendering used by control-plane/reporting views.
 */
import { describe, it, expect } from "vitest";
import { formatChain, type TenantNode } from "../src/modules/tenant/federation.js";

const CHAIN: TenantNode[] = [
  { id: "m", name: "Ministry of Rural Development", govLevel: "nation", parentTenantId: null, depth: 3 },
  { id: "s", name: "State of Odisha", govLevel: "state", parentTenantId: "m", depth: 2 },
  { id: "d", name: "Khordha District", govLevel: "district", parentTenantId: "s", depth: 1 },
  { id: "p", name: "Khordha RD Department", govLevel: "department", parentTenantId: "d", depth: 0 },
];

describe("tenant federation chain (EPIC-3 T3.1)", () => {
  it("renders the ancestry root-first regardless of input order", () => {
    const shuffled = [CHAIN[3], CHAIN[1], CHAIN[0], CHAIN[2]];
    expect(formatChain(shuffled)).toBe(
      "Ministry of Rural Development > State of Odisha > Khordha District > Khordha RD Department",
    );
  });

  it("handles a single-node chain (a root tenant)", () => {
    expect(formatChain([CHAIN[0]])).toBe("Ministry of Rural Development");
  });

  it("handles an empty chain", () => {
    expect(formatChain([])).toBe("");
  });
});
