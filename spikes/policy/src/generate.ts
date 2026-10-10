/**
 * Seeded, deterministic synthetic workforce generator for the policy spike.
 *
 * NO REAL PERSONAL DATA. Every field is derived from a seeded PRNG (mulberry32)
 * so the same seed always yields the same population — required for the
 * determinism and benchmark criteria of D-ST-07. Values are the minimal set the
 * synthetic rule packs read; there are no names, no identifiers that map to a
 * person, nothing resembling PII.
 */

/** mulberry32: a tiny, fast, fully-deterministic 32-bit PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The synthetic employee record consumed by all three rule packs. */
export interface SyntheticEmployee {
  readonly id: number;
  readonly tenureMonths: number;
  readonly hardshipPosting: boolean;
  readonly sensitivePost: boolean;
  readonly monthsInPost: number;
  readonly medicalGround: boolean;
  readonly spouseGround: boolean;
  readonly disability: boolean;
}

/**
 * Generate `count` synthetic employees from `seed`. Deterministic: identical
 * (count, seed) → identical array, element for element.
 */
export function generateWorkforce(
  count: number,
  seed: number,
): SyntheticEmployee[] {
  const rand = mulberry32(seed);
  const out: SyntheticEmployee[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const tenureMonths = Math.floor(rand() * 120); // 0..119 months
    const monthsInPost = Math.floor(rand() * 96); // 0..95 months
    out[i] = {
      id: i,
      tenureMonths,
      hardshipPosting: rand() < 0.15,
      sensitivePost: rand() < 0.2,
      monthsInPost,
      medicalGround: rand() < 0.05,
      spouseGround: rand() < 0.08,
      disability: rand() < 0.03,
    };
  }
  return out;
}
