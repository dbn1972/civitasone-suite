import { describe, it, expect } from "vitest";
import { mapInterns } from "./internsModel";

const emp = (id: string, employeeType: string) => ({ id, name: "N" + id, department: "D", employeeType, status: "active" });

describe("mapInterns (GAP-HR-WORKFORCE-INTERNS-01)", () => {
  it("renders paise as rupees for an apprentice and a dash for a plain intern", () => {
    const rows = mapInterns(
      [emp("a", "apprentice"), emp("i", "intern"), emp("x", "permanent")],
      [{ apprenticeId: "a", monthlyStipendMinor: "1500000", trainingStart: "2026-02-01", trainingEnd: null, status: "active" }],
    );
    expect(rows.map((r) => r.id)).toEqual(["a", "i"]);
    expect(rows[0]!.stipend).toBe("₹15,000.00");
    expect(rows[0]!.period).toMatch(/01 Feb 2026 – …/);
    expect(rows[1]!.stipend).toBe("—");
    expect(rows[1]!.period).toBe("—");
  });

  it("prefers the active engagement over a completed one for the same apprentice", () => {
    const rows = mapInterns(
      [emp("a", "apprentice")],
      [
        { apprenticeId: "a", monthlyStipendMinor: "100000", trainingStart: "2025-01-01", status: "completed" },
        { apprenticeId: "a", monthlyStipendMinor: "200000", trainingStart: "2024-01-01", status: "active" },
      ],
    );
    expect(rows[0]!.stipend).toBe("₹2,000.00");
  });

  it("is a dash when stipend is absent (not ₹0.00)", () => {
    const rows = mapInterns([emp("a", "apprentice")], [{ apprenticeId: "a", status: "active" }]);
    expect(rows[0]!.stipend).toBe("—");
  });
});
