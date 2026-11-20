import { describe, it, expect } from "vitest";
import { formatReleaseNo } from "../src/modules/disbursement/domain.js";

describe("formatReleaseNo", () => {
  const ID = "3f2a9c1e-7b44-4d0a-9e51-0a1b2c3d4e5f";
  it("is a readable REL-<year>-<8 hex> number, not a PFMS transaction id", () => {
    expect(formatReleaseNo(ID, new Date("2026-09-14T10:00:00Z"))).toBe("REL-2026-3F2A9C1E");
  });
  it("is stable and unique per disbursement id", () => {
    expect(formatReleaseNo(ID, "2026-01-02")).toBe(formatReleaseNo(ID, "2026-01-02"));
    expect(formatReleaseNo("aaaaaaaa-0000-4000-8000-000000000000", "2026-01-02")).not.toBe(formatReleaseNo(ID, "2026-01-02"));
  });
});
