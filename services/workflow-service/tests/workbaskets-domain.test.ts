/** CAP-035 — workbasket filter normalization: whitelist + conflict rules. */
import { describe, it, expect } from "vitest";
import { normalizeFilter } from "../src/modules/workbaskets/domain.js";

describe("normalizeFilter", () => {
  it("accepts a valid filter and sort", () => {
    const r = normalizeFilter({ status: ["pending", "active"], unassigned: true }, "due_at");
    expect(r.errors).toEqual([]);
    expect(r.filter.status).toEqual(["pending", "active"]);
    expect(r.sortOrder).toBe("due_at");
  });
  it("rejects unknown statuses", () => {
    expect(normalizeFilter({ status: ["bogus"] }).errors).toContain("INVALID_STATUS");
  });
  it("rejects an unknown sort key", () => {
    expect(normalizeFilter({}, "; DROP TABLE").errors).toContain("INVALID_SORT");
  });
  it("rejects assignee + unassigned together", () => {
    expect(normalizeFilter({ assigneeId: "u1", unassigned: true }).errors).toContain("ASSIGNEE_AND_UNASSIGNED");
  });
  it("defaults to an empty filter", () => {
    const r = normalizeFilter(undefined);
    expect(r.filter).toEqual({});
    expect(r.errors).toEqual([]);
  });
});
