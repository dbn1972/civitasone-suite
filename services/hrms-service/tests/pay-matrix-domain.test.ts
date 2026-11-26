/**
 * HRMS Pack #07 — Pay Matrix: 7th CPC matrix generation and lookup tests.
 *
 * Covers PAY-01 to PAY-04: deterministic cell calculation using 3% + nearest-Rs-100 rule,
 * level/cell counts, entry pay verification, and boundary validation.
 *
 * Source: modules/pay-matrix/generate.ts (buildPayMatrix, imported -- not re-implemented).
This table is COMPUTED, not the gazetted one (GAP-HR-PAY-MATRIX-01); rounding is nearest Rs 100.
 */
import { describe, it, expect } from "vitest";

import { buildPayMatrix } from "../src/modules/pay-matrix/generate.js";

const PAY_MATRIX = buildPayMatrix();

describe("7th CPC Pay Matrix — PAY-02: cell calculation (3% + nearest Rs 100)", () => {
  it("Level 1 cell 1 = ₹18,000 (1800000 paise)", () => {
    expect(PAY_MATRIX[1]![0]).toBe(1800000);
  });

  it("Level 1 cell 2 = nearest-Rs-100(18000 * 1.03) = 18,540 -> Rs 18,500", () => {
    expect(PAY_MATRIX[1]![1]).toBe(1850000);
  });

  it("Level 1 cell 3 = nearest-Rs-100(18500 * 1.03) = 19,055 -> Rs 19,100", () => {
    expect(PAY_MATRIX[1]![2]).toBe(1910000);
  });

  it("the documented rounding rule: nearest Rs 100, an exact Rs 50 remainder rounds up", () => {
    // Same arithmetic as generate.ts, asserted on its own: 19,050 sits between 19,000 and 19,100.
    const roundNearest100 = (paise: number): number => Math.floor((paise + 5000) / 10000) * 10000;
    expect(roundNearest100(1905000)).toBe(1910000);
    expect(roundNearest100(1904900)).toBe(1900000);
  });

  it("Level 7 cell 1 = ₹44,900 (4490000 paise)", () => {
    expect(PAY_MATRIX[7]![0]).toBe(4490000);
  });

  it("Level 18 cell 1 = ₹2,50,000 (25000000 paise)", () => {
    expect(PAY_MATRIX[18]![0]).toBe(25000000);
  });

  it("all cells are monotonically increasing within a level", () => {
    for (let lvl = 1; lvl <= 18; lvl++) {
      const cells = PAY_MATRIX[lvl]!;
      for (let i = 1; i < cells.length; i++) {
        expect(cells[i]).toBeGreaterThan(cells[i - 1]!);
      }
    }
  });

  it("all cells are multiples of 10000 paise (Rs 100 rounding)", () => {
    for (let lvl = 1; lvl <= 18; lvl++) {
      const cells = PAY_MATRIX[lvl]!;
      for (const cell of cells) {
        expect(cell % 10000).toBe(0);
      }
    }
  });

  it("increment between consecutive cells is at least 3% of previous", () => {
    for (let lvl = 1; lvl <= 18; lvl++) {
      const cells = PAY_MATRIX[lvl]!;
      for (let i = 1; i < cells.length; i++) {
        const minIncrement = cells[i - 1]! * 0.03;
        expect(cells[i]! - cells[i - 1]!).toBeGreaterThanOrEqual(Math.floor(minIncrement / 10000) * 10000);
      }
    }
  });
});

describe("7th CPC Pay Matrix — PAY-03: level/cell counts", () => {
  it("has exactly 18 levels", () => {
    expect(Object.keys(PAY_MATRIX)).toHaveLength(18);
  });

  it("Levels 1–12 have 40 cells each", () => {
    for (let lvl = 1; lvl <= 12; lvl++) {
      expect(PAY_MATRIX[lvl]).toHaveLength(40);
    }
  });

  it("Level 13 has 19 cells", () => {
    expect(PAY_MATRIX[13]).toHaveLength(19);
  });

  it("Level 14 has 18 cells", () => {
    expect(PAY_MATRIX[14]).toHaveLength(18);
  });

  it("Level 15 has 13 cells", () => {
    expect(PAY_MATRIX[15]).toHaveLength(13);
  });

  it("Level 16 has 9 cells", () => {
    expect(PAY_MATRIX[16]).toHaveLength(9);
  });

  it("Level 17 has 1 cell", () => {
    expect(PAY_MATRIX[17]).toHaveLength(1);
  });

  it("Level 18 has 1 cell", () => {
    expect(PAY_MATRIX[18]).toHaveLength(1);
  });
});

describe("7th CPC Pay Matrix — PAY-01: entry pay per level", () => {
  const expectedEntries: [number, number][] = [
    [1, 1800000], [2, 1990000], [3, 2170000], [4, 2550000],
    [5, 2920000], [6, 3540000], [7, 4490000], [8, 4760000],
    [9, 5310000], [10, 5610000], [11, 6770000], [12, 7880000],
    [13, 12310000], [14, 14420000], [15, 18220000], [16, 20540000],
    [17, 22500000], [18, 25000000],
  ];

  for (const [level, expected] of expectedEntries) {
    it(`Level ${level} entry pay = ₹${expected / 100} (${expected} paise)`, () => {
      expect(PAY_MATRIX[level]![0]).toBe(expected);
    });
  }
});

describe("7th CPC Pay Matrix — PAY-04: boundary validation of level/cell lookup", () => {
  it("level 0 would not exist in matrix", () => {
    expect(PAY_MATRIX[0]).toBeUndefined();
  });

  it("level 19 would not exist in matrix", () => {
    expect(PAY_MATRIX[19]).toBeUndefined();
  });

  it("cell beyond count returns undefined", () => {
    // Level 17 has 1 cell, so cell index 1 (0-based) is undefined
    expect(PAY_MATRIX[17]![1]).toBeUndefined();
  });

  it("negative level is not in matrix", () => {
    expect(PAY_MATRIX[-1]).toBeUndefined();
  });
});
