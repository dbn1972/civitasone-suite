import { describe, it, expect } from "vitest";
import { activeChildCount, headDisplayName, isUnitInactive, orgConflictMessage } from "./orgUnitState";
import type { AdminOrgUnit } from "@/app/_data/loaders";

const u = (id: string, parentId: string | null, effectiveTo: string | null = null): AdminOrgUnit => ({
  id, tenantId: "t", name: id, type: "unit", parentId, headUserId: null, code: null, effectiveTo,
});
const NOW = Date.parse("2026-10-03T00:00:00Z");

describe("orgUnitState", () => {
  it("inactive only when the end date has passed", () => {
    expect(isUnitInactive(u("a", null), NOW)).toBe(false);
    expect(isUnitInactive(u("a", null, "2026-10-02T00:00:00Z"), NOW)).toBe(true);
    expect(isUnitInactive(u("a", null, "2026-12-01T00:00:00Z"), NOW)).toBe(false);
    expect(isUnitInactive(u("a", null, "not a date"), NOW)).toBe(false);
  });
  it("uses IST calendar days: the same IST day is inactive, the next IST day is not", () => {
    // 2026-10-03T19:00Z is 2026-10-04 00:30 IST
    const now = Date.parse("2026-10-03T19:00:00Z");
    expect(isUnitInactive(u("a", null, "2026-10-03T20:00:00Z"), now)).toBe(true);
    expect(isUnitInactive(u("a", null, "2026-10-04T19:00:00Z"), now)).toBe(false);
    expect(isUnitInactive(u("a", null, "2026-10-03T18:00:00Z"), now)).toBe(true);
  });
  it("counts only in-force direct children", () => {
    const units = [u("p", null), u("c1", "p"), u("c2", "p", "2026-01-01T00:00:00Z"), u("g", "c1")];
    expect(activeChildCount(units, "p", NOW)).toBe(1);
    expect(activeChildCount(units, "c2", NOW)).toBe(0);
  });
  it("never shows a raw id for the head", () => {
    expect(headDisplayName(null, new Map())).toBeNull();
    expect(headDisplayName("11111111-1111-4111-8111-111111111111", new Map([["11111111-1111-4111-8111-111111111111", "Asha Rao"]]))).toBe("Asha Rao");
    expect(headDisplayName("22222222-2222-4222-8222-222222222222", new Map())).toBe("Unknown user");
  });
  it("maps known backend codes to plain language, unknown to null", () => {
    expect(orgConflictMessage("HAS_ACTIVE_CHILDREN")).toMatch(/sub-units/);
    expect(orgConflictMessage("PARENT_INACTIVE")).toMatch(/deactivated/);
    expect(orgConflictMessage("HAS_ACTIVE_POSITIONS")).toMatch(/open positions/);
    expect(orgConflictMessage("UNIT_INACTIVE")).toMatch(/deactivated/);
    expect(orgConflictMessage("SOMETHING_ELSE")).toBeNull();
    expect(orgConflictMessage(undefined)).toBeNull();
  });
});
