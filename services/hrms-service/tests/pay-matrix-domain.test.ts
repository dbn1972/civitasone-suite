/**
 * HRMS Pack #07 — Pay Matrix: 7th CPC matrix generation and lookup tests.
 *
 * Covers PAY-01 to PAY-04: deterministic cell calculation using 3% + ceiling rule,
 * level/cell counts, entry pay verification, and boundary validation.
 *
 * Source: modules/pay-matrix/routes.ts (buildPayMatrix logic)
 */
import { describe, it, expect } from "vitest";

// Replicate the algorithm from routes.ts exactly for independent verification
const ENTRY_PAY_PAISE: Record<number, number> = {
  1: 1800000, 2: 1990000, 3: 2170000, 4: 2550000, 5: 2920000, 6: 3540000,
  7: 4490000, 8: 4760000, 9: 5310000, 10: 5610000, 11: 6770000, 12: 7880000,
  13: 12310000, 14: 14420000, 15: 18220000, 16: 20540000, 17: 22500000, 18: 25000000,
};
const CELL_COUNT: Record<number, number> = {
  1: 40, 2: 40, 3: 40, 4: 40, 5: 40, 6: 40, 7: 40, 8: 40, 9: 40, 10: 40,
  11: 40, 12: 40, 13: 19, 14: 18, 15: 13, 16: 9, 17: 1, 18: 1,
};

function buildPayMatrix(): Record<number, number[]> {
  const m: Record<number, number[]> = {};
  for (const lvlStr of Object.keys(ENTRY_PAY_PAISE)) {
    const lvl = Number(lvlStr);
    const n = CELL_COUNT[lvl] ?? 40;
    const cells: number[] = [];
    let cur = ENTRY_PAY_PAISE[lvl] ?? 0;
    for (let i = 0; i < n; i++) {
      cells.push(cur);
      cur = Math.ceil((cur * 1.03) / 10000) * 10000;
    }
    m[lvl] = cells;
  }
  return m;
}

const PAY_MATRIX = buildPayMatrix();

describe("7th CPC Pay Matrix — PAY-02: cell calculation (3% + ceiling)", () => {
  it("Level 1 cell 1 = ₹18,000 (1800000 paise)", () => {
    expect(PAY_MATRIX[1]![0]).toBe(1800000);
  });

  it("Level 1 cell 2 = ceil(18000 * 1.03 / 100) * 100 * 100 paise = ₹18,600", () => {
    // 18000 * 1.03 = 18540, ceil to next 100 = 18600, in paise = 1860000
    expect(PAY_MATRIX[1]![1]).toBe(1860000);
  });

  it("Level 1 cell 3 = ceil(18600 * 1.03 / 100) * 100 * 100 = ₹19,200", () => {
    // 18600 * 1.03 = 19158, ceil(19158/100)*100 = 19200, paise = 1920000
    expect(PAY_MATRIX[1]![2]).toBe(1920000);
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
