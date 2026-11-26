/**
 * GAP-HR-PAY-MATRIX-01: the COMPUTED (not notified) 7th CPC matrix generator, split out of
 * routes.ts so it is a pure module the tests import instead of re-implementing. See the long
 * comment on isPayMatrixOfficial() in routes.ts: until HR/Finance load the gazetted table this
 * stays labelled NOT OFFICIAL and the live annual increment stays blocked (409).
 * All values are paise (Rs x 100).
 */
export const ENTRY_PAY_PAISE: Record<number, number> = {
  1: 1800000, 2: 1990000, 3: 2170000, 4: 2550000, 5: 2920000, 6: 3540000,
  7: 4490000, 8: 4760000, 9: 5310000, 10: 5610000, 11: 6770000, 12: 7880000,
  13: 12310000, 14: 14420000, 15: 18220000, 16: 20540000, 17: 22500000, 18: 25000000,
};
export const CELL_COUNT: Record<number, number> = {
  1: 40, 2: 40, 3: 40, 4: 40, 5: 40, 6: 40, 7: 40, 8: 40, 9: 40, 10: 40,
  11: 40, 12: 40, 13: 19, 14: 18, 15: 13, 16: 9, 17: 1, 18: 1,
};
export function buildPayMatrix(): Record<number, number[]> {
  const m: Record<number, number[]> = {};
  for (const lvlStr of Object.keys(ENTRY_PAY_PAISE)) {
    const lvl = Number(lvlStr);
    const n = CELL_COUNT[lvl] ?? 40;
    const cells: number[] = [];
    let cur = ENTRY_PAY_PAISE[lvl] ?? 0;
    for (let i = 0; i < n; i++) {
      cells.push(cur);
      // +3%, rounded to the NEAREST Rs 100 (owner decision 26 Nov 2026; the notified Level 1
      // sequence 18,000 -> 18,500 -> 19,100 is nearest-100, not round-up). Integer paise
      // maths: cur is a multiple of 10000, so cur*103/100 is exact; ties round up.
      cur = Math.floor(((cur * 103) / 100 + 5000) / 10000) * 10000;
    }
    m[lvl] = cells;
  }
  return m;
}
