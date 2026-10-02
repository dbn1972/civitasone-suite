import { describe, it, expect } from "vitest";
import { parseCap, summarizeEntitlements, toEntitlementRow } from "./entitlementModel";

const row = (o: Record<string, unknown>) => toEntitlementRow(o);

// GAP-ADMIN-ENTITLEMENTS-04
describe("usage / over-limit", () => {
  it("used=100, limit='100' is over limit (text state, not colour only)", () => {
    const r = row({ module: "hrms", limit: "100", used: 100 });
    expect(r.limitState).toBe("over");
    expect(r.usage).toBe("100 / 100");
    expect(r.usedPct).toBe(100);
  });
  it("90%+ is near limit; below is ok", () => {
    expect(row({ limit: "100", used: 95 }).limitState).toBe("near");
    expect(row({ limit: "100", used: 50 }).limitState).toBe("ok");
  });
  it("null / unlimited / non-numeric limit never flags", () => {
    for (const limit of [null, undefined, "unlimited", "", "-"]) {
      const r = row({ limit, used: 999999 });
      expect(r.limitState).toBe("ok");
      expect(r.usedPct).toBeNull();
    }
    expect(parseCap("unlimited")).toBeNull();
    expect(parseCap("0")).toBeNull();
    expect(parseCap("250")).toBe(250);
  });
});

describe("summary", () => {
  const rows = [
    { edition: "psu", status: "active", limit: "10", used: 10 },
    { edition: "psu", status: "Active" },
    { status: "revoked" },
    { edition: " state ", status: "expired" },
    { edition: "", status: "suspended" },
  ].map(toEntitlementRow);

  // GAP-ADMIN-ENTITLEMENTS-05
  it("Editions counts distinct non-empty trimmed editions only", () => {
    expect(summarizeEntitlements(rows).editions).toBe(2);
    expect(summarizeEntitlements([{ edition: "psu" }, { edition: "psu" }, {}].map(toEntitlementRow)).editions).toBe(1);
    expect(summarizeEntitlements([{}, {}].map(toEntitlementRow)).editions).toBe(0);
  });

  // GAP-ADMIN-ENTITLEMENTS-07
  it("Revoked is only status=revoked; the rest of the inactive rows are 'other inactive'", () => {
    const s = summarizeEntitlements(
      ["active", "revoked", "expired", "draft"].map((status) => toEntitlementRow({ status })),
    );
    expect(s).toMatchObject({ total: 4, active: 1, revoked: 1, otherInactive: 2 });
  });

  it("counts rows at/over their cap", () => {
    expect(summarizeEntitlements(rows).atLimit).toBe(1);
  });
});
