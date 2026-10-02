import { describe, it, expect } from "vitest";
import { auditParaTone } from "./auditParaTone";

describe("auditParaTone (GAP-FINANCE-AUDIT-PARAS-01)", () => {
  it("maps every register status", () => {
    expect(auditParaTone("open")).toBe("bad");
    expect(auditParaTone("escalated")).toBe("bad");
    expect(auditParaTone("responded")).toBe("warn");
    expect(auditParaTone("settled")).toBe("good");
    expect(auditParaTone("dropped")).toBe("mut");
  });
  it("is case-insensitive and falls back to info for unknown values", () => {
    expect(auditParaTone("OPEN")).toBe("bad");
    expect(auditParaTone("mystery")).toBe("info");
  });
});
