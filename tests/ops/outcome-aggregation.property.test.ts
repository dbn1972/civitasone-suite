/**
 * Property test for outcome-aggregation determinism (task 15.2).
 *
 * Property 8: Outcome-aggregation is deterministic across backup and drill runs.
 * Validates: Requirements 11.2, 11.4, 12.3, 12.4, 12.6
 *
 * NOTE: lives under tests/ops/ (not scripts/ops/tests/) because the root
 * vitest.config.mjs only includes "tests/**\/*.test.ts".
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  aggregateOutcomes,
  exitCodeFor,
  OUTCOMES,
  TIER01_SERVICES,
} from "../../scripts/ops/lib/outcome-aggregation.mjs";

const arbOutcome = fc.constantFrom(OUTCOMES.SUCCESS, OUTCOMES.FAILED, OUTCOMES.SKIPPED);
const arbServiceName = fc.stringMatching(/^[a-z][a-z0-9-]{1,20}$/);

/** Build a { service: outcome } map from a subset of TIER01_SERVICES plus optional extras. */
const arbOutcomesMap = fc
  .record({
    // Subset of the critical universe (some services intentionally omitted to exercise "missing").
    criticalSubset: fc.subarray(TIER01_SERVICES),
    criticalOutcomes: fc.array(arbOutcome, { minLength: 0, maxLength: TIER01_SERVICES.length }),
    extraServices: fc.uniqueArray(arbServiceName, { maxLength: 5 }),
    extraOutcomes: fc.array(arbOutcome, { minLength: 0, maxLength: 5 }),
  })
  .map(({ criticalSubset, criticalOutcomes, extraServices, extraOutcomes }) => {
    const map: Record<string, string> = {};
    criticalSubset.forEach((svc, i) => {
      if (i < criticalOutcomes.length) map[svc] = criticalOutcomes[i]!;
    });
    extraServices
      .filter((s) => !TIER01_SERVICES.includes(s as (typeof TIER01_SERVICES)[number]))
      .forEach((svc, i) => {
        if (i < extraOutcomes.length) map[svc] = extraOutcomes[i]!;
      });
    return map;
  });

describe("Property 8: outcome-aggregation is deterministic", () => {
  it("calling aggregateOutcomes twice with the same input produces a byte-identical report", () => {
    fc.assert(
      fc.property(arbOutcomesMap, (outcomesByService) => {
        const a = aggregateOutcomes(outcomesByService);
        const b = aggregateOutcomes(outcomesByService);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      }),
      { numRuns: 200 },
    );
  });

  it("the result does not depend on key-insertion order of the outcomes map", () => {
    fc.assert(
      fc.property(arbOutcomesMap, (outcomesByService) => {
        const entries = Object.entries(outcomesByService);
        const reversed = Object.fromEntries(entries.slice().reverse());
        const shuffled = Object.fromEntries(
          entries
            .map((e) => [Math.random(), e] as const)
            .sort((a, b) => a[0] - b[0])
            .map(([, e]) => e),
        );
        const a = aggregateOutcomes(outcomesByService);
        const b = aggregateOutcomes(reversed);
        const c = aggregateOutcomes(shuffled);
        expect(JSON.stringify(b)).toBe(JSON.stringify(a));
        expect(JSON.stringify(c)).toBe(JSON.stringify(a));
      }),
      { numRuns: 200 },
    );
  });

  it("overall fails iff at least one critical service is failed or missing; skipped never causes failure by itself", () => {
    fc.assert(
      fc.property(arbOutcomesMap, (outcomesByService) => {
        const report = aggregateOutcomes(outcomesByService);
        const shouldFail = report.failedServices.length > 0 || report.missingServices.length > 0;
        expect(report.overall).toBe(shouldFail ? "fail" : "pass");
        expect(exitCodeFor(report)).toBe(shouldFail ? 1 : 0);

        // Every critical service is classified into exactly one bucket.
        const total =
          report.succeededServices.length +
          report.failedServices.length +
          report.skippedServices.length +
          report.missingServices.length;
        expect(total).toBe(report.criticalServices.length);
      }),
      { numRuns: 200 },
    );
  });

  it("a non-critical-only failure never fails the overall run (Req 11.2 scopes to Tier-0/Tier-1)", () => {
    fc.assert(
      fc.property(
        fc.subarray(TIER01_SERVICES),
        fc.array(fc.constant(OUTCOMES.SUCCESS), { minLength: 0, maxLength: TIER01_SERVICES.length }),
        arbServiceName.filter((s) => !TIER01_SERVICES.includes(s as (typeof TIER01_SERVICES)[number])),
        (criticalSubset, criticalOutcomes, nonCriticalService) => {
          const map: Record<string, string> = {};
          criticalSubset.forEach((svc, i) => {
            if (i < criticalOutcomes.length) map[svc] = criticalOutcomes[i]!;
          });
          map[nonCriticalService] = OUTCOMES.FAILED;

          // Scope the critical universe to exactly criticalSubset — the
          // non-critical service must never affect overall regardless of the
          // caller's chosen critical universe.
          const report = aggregateOutcomes(map, criticalSubset);
          expect(report.nonCriticalFailedServices).toContain(nonCriticalService);
          // Overall reflects only the critical universe: since every explicitly-set
          // critical outcome here is "success", overall is "pass" iff nothing is missing.
          const anyMissing = criticalSubset.length > criticalOutcomes.length;
          expect(report.overall).toBe(anyMissing ? "fail" : "pass");
        },
      ),
      { numRuns: 200 },
    );
  });

  it("rejects invalid outcome values deterministically (never silently coerces to a valid one)", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !Object.values(OUTCOMES).includes(s as never) && s.length > 0),
        (badOutcome) => {
          const map = { finance: badOutcome };
          expect(() => aggregateOutcomes(map)).toThrow(TypeError);
          expect(() => aggregateOutcomes(map)).toThrow(TypeError); // repeat call, same failure
        },
      ),
      { numRuns: 50 },
    );
  });
});
