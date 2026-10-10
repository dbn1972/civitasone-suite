/**
 * generate.ts — a seeded, deterministic synthetic workforce generator.
 *
 * NO REAL PERSONAL DATA. Every employee and position is fabricated from a
 * splitmix64 PRNG seeded by an integer, so a given (size, seed) always produces
 * the byte-identical snapshot. This feeds the 1k / 10k / 100k benchmarks and the
 * property tests (spec §7, §16; synthetic datasets requirement).
 */

import { createHash } from "node:crypto";
import type {
  AllocationSnapshot,
  EmployeePreference,
  HardConstraint,
  SnapshotEmployee,
  SnapshotPosition,
  SoftObjective,
} from "./SolverPort.js";

/**
 * splitmix64: a tiny, fast, well-distributed deterministic generator. Pure
 * arithmetic on BigInt so results are identical on arm64 and x64 (no float).
 */
export class Prng {
  private state: bigint;
  private static readonly MASK = (1n << 64n) - 1n;

  constructor(seed: number) {
    // Mix the seed so small seeds still produce well-spread streams.
    this.state = BigInt.asUintN(64, BigInt(Math.trunc(seed)) * 0x9e3779b97f4a7c15n + 0x1n);
  }

  /** Next raw 64-bit value. */
  next(): bigint {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & Prng.MASK;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & Prng.MASK;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & Prng.MASK;
    return (z ^ (z >> 31n)) & Prng.MASK;
  }

  /** Uniform float in [0, 1). Derived from the top 53 bits (exact in f64). */
  float(): number {
    return Number(this.next() >> 11n) / 2 ** 53;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    if (n <= 0) return 0;
    return Number(this.next() % BigInt(n));
  }

  /** Pick an element deterministically. */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)]!;
  }
}

const CADRES = ["GEN", "TECH", "MED", "EDU", "POL"] as const;
const QUALS = ["Q_A", "Q_B", "Q_C", "Q_D", "Q_E", "Q_F"] as const;
const JURISDICTIONS = ["J01", "J02", "J03", "J04", "J05", "J06", "J07", "J08"] as const;
const LOCATION_CLASSES = ["X", "Y", "Z"] as const;

export interface GenerateOptions {
  readonly employeeCount: number;
  readonly seed: number;
  /**
   * Vacancy ratio: positions = round(employeeCount * (1 + vacancyRatio)). A
   * ratio > 0 means there are more posts than employees (some posts stay empty);
   * the baseline must still never duplicate occupancy.
   */
  readonly vacancyRatio?: number;
  /** Fraction of employees under a legal hold (hard-blocked). */
  readonly holdRatio?: number;
}

/**
 * Build a frozen snapshot. Positions and employees are correlated on
 * (cadre, grade, jurisdiction) so that most employees have at least one feasible
 * post, while a controlled minority are structurally blocked (to exercise the
 * minimal-blocking-constraint diagnosis).
 */
export function generateSnapshot(opts: GenerateOptions): AllocationSnapshot {
  const vacancyRatio = opts.vacancyRatio ?? 0.08;
  const holdRatio = opts.holdRatio ?? 0.02;
  const positionCount = Math.round(opts.employeeCount * (1 + vacancyRatio));

  const rng = new Prng(opts.seed);

  const positions: SnapshotPosition[] = [];
  for (let i = 0; i < positionCount; i++) {
    const cadre = CADRES[i % CADRES.length]!;
    const grade = 1 + rng.int(5);
    const jurisdictionUnitId = JURISDICTIONS[rng.int(JURISDICTIONS.length)]!;
    // Most posts require a single qual drawn from a cadre-correlated subset.
    const reqCount = rng.float() < 0.6 ? 1 : rng.float() < 0.5 ? 0 : 2;
    const requiredQualifications: string[] = [];
    for (let q = 0; q < reqCount; q++) requiredQualifications.push(rng.pick(QUALS));
    positions.push({
      id: `P${String(i).padStart(7, "0")}`,
      cadre,
      grade,
      requiredQualifications: dedupeSort(requiredQualifications),
      jurisdictionUnitId,
      capacity: 1,
      sensitive: rng.float() < 0.05,
      minimumStaffing: 0,
      locationClass: LOCATION_CLASSES[rng.int(LOCATION_CLASSES.length)]!,
    });
  }

  const employees: SnapshotEmployee[] = [];
  const preferences: EmployeePreference[] = [];
  for (let i = 0; i < opts.employeeCount; i++) {
    const cadre = CADRES[i % CADRES.length]!;
    const grade = 1 + rng.int(5);
    const jurisdictionUnitId = JURISDICTIONS[rng.int(JURISDICTIONS.length)]!;
    // Give the employee a qualification set that usually satisfies some post.
    const qualCount = 1 + rng.int(3);
    const qualifications: string[] = [];
    for (let q = 0; q < qualCount; q++) qualifications.push(rng.pick(QUALS));
    const id = `E${String(i).padStart(7, "0")}`;
    const hold = rng.float() < holdRatio;
    employees.push({
      id,
      cadre,
      grade,
      qualifications: dedupeSort(qualifications),
      jurisdictionUnitId,
      currentPositionId: null,
      tenureMonths: rng.int(120),
      hold,
      hardshipPriority: rng.float() < 0.1 ? 1 + rng.int(3) : 0,
      mayRemainUnassigned: true,
    });

    // Ranked preferences: a short deterministic list of candidate position ids.
    const prefCount = 1 + rng.int(5);
    const ranked: string[] = [];
    for (let p = 0; p < prefCount; p++) {
      ranked.push(`P${String(rng.int(positionCount)).padStart(7, "0")}`);
    }
    preferences.push({ employeeId: id, rankedPositionIds: dedupeKeepOrder(ranked) });
  }

  // A representative set of additional declared hard constraints and the
  // approved, documented soft weights (spec §7.1 "no undocumented weight").
  const hardConstraints: HardConstraint[] = [
    // Example named location restriction: nobody may be forced into class Z by a
    // soft objective. (Structural constraints are derived in the validator.)
    { kind: "locationRestriction", params: { forbiddenForSoft: ["Z"] } },
  ];
  const softObjectives: SoftObjective[] = [
    { kind: "preference", weight: 10 },
    { kind: "hardshipPriority", weight: 25 },
    { kind: "tenureFairness", weight: 5 },
    { kind: "minimumDisruption", weight: 3 },
    { kind: "criticalVacancyCoverage", weight: 8 },
  ];

  const snapshotId = contentHash({
    employeeCount: opts.employeeCount,
    seed: opts.seed,
    vacancyRatio,
    holdRatio,
    positionCount,
  });

  return {
    snapshotId,
    employees,
    positions,
    preferences,
    hardConstraints,
    softObjectives,
    partitionOf: (e) => `${e.cadre}:${e.jurisdictionUnitId}`,
  };
}

function dedupeSort(xs: string[]): string[] {
  return [...new Set(xs)].sort();
}

function dedupeKeepOrder(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

function contentHash(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 24);
}
