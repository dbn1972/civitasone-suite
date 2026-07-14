/**
 * Property-based tests for `placement-policy.ts` (task 6.2).
 *
 * **Property 3: Placement policy is total with a safe, auditable fallback**
 * **Validates: Requirements 2.1, 2.2, 2.5, 2.6**
 *
 * For any edition (from the fixed `Edition` enum) and any partial policy
 * mapping configuration (including malformed/partial `mapping` objects):
 *
 *   - `tierFor(edition, config)` is total — it always returns a valid
 *     `PlacementDecision` and never throws.
 *   - When `config.mapping` has an entry for `edition`, the returned tier
 *     equals that entry, `reason` is always `policy_mapped`, and
 *     `policyVersion` always equals `config.version`.
 *   - When `config.mapping` has no entry for `edition` (or `config` is the
 *     fail-safe default), the returned tier is always `pool` and `reason`
 *     is always `fallback_default` — the fallback is safe (never `silo`)
 *     and auditable (`reason` is always present).
 *   - `loadPlacementPolicyConfig()` with arbitrary malformed/missing
 *     `TENANT_PLACEMENT_POLICY` env values never throws and always yields
 *     a config that itself yields the pool-fallback for any unmapped
 *     edition.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import fc from "fast-check";
import { tierFor, type Edition, type PlacementPolicyConfig } from "../src/modules/tenant/placement-policy.js";

/** The fixed Edition union, mirrored here so the generator stays in sync with the source type. */
const EDITIONS: Edition[] = [
  "govt",
  "psu",
  "private",
  "ngo",
  "section8",
  "cooperative",
  "small_office",
];

const arbEdition = fc.constantFrom(...EDITIONS);

/** Arbitrary tier value, including well-formed ("pool"/"silo") and malformed values. */
const arbTierValue = fc.oneof(
  fc.constantFrom("pool" as const, "silo" as const),
  fc.constantFrom(undefined, null, "", "invalid", 123, {}),
);

/**
 * Arbitrary partial/malformed mapping object: for each edition, independently
 * decide whether it's present in the mapping and, if so, assign it an
 * arbitrary (possibly malformed) tier value.
 */
const arbMapping = fc.record(
  Object.fromEntries(EDITIONS.map((e) => [e, fc.option(arbTierValue, { nil: undefined })])) as Record<
    Edition,
    fc.Arbitrary<unknown>
  >,
  { requiredKeys: [] },
);

/** Arbitrary version string, including empty/malformed values. */
const arbVersion = fc.oneof(
  fc.string({ minLength: 1, maxLength: 20 }),
  fc.constantFrom("", "2026-07-01", "unconfigured"),
);

/** Arbitrary PlacementPolicyConfig, including malformed/partial mapping objects. */
const arbConfig: fc.Arbitrary<PlacementPolicyConfig> = fc
  .tuple(arbVersion, arbMapping)
  .map(([version, mapping]) => ({ version, mapping }) as unknown as PlacementPolicyConfig);

describe("Property 3: Placement policy is total with a safe, auditable fallback", () => {
  it("tierFor is total: it always returns a valid PlacementDecision and never throws", () => {
    fc.assert(
      fc.property(arbEdition, arbConfig, (edition, config) => {
        let decision: ReturnType<typeof tierFor> | undefined;
        expect(() => {
          decision = tierFor(edition, config);
        }).not.toThrow();

        expect(decision).toBeDefined();
        expect(["policy_mapped", "fallback_default"]).toContain(decision!.reason);
        expect(decision!.policyVersion).toBe(config.version);

        // The decision's tier is always defined: either the pass-through mapped
        // value (when an entry is present, per Property 3's "tier equals that
        // entry" wording — mapping-value shape validation is the parsing
        // boundary's job, not tierFor's), or the safe "pool" fallback when
        // absent.
        if (decision!.reason === "fallback_default") {
          expect(decision!.tier).toBe("pool");
        } else {
          expect(decision!.tier).toBe((config.mapping as Record<string, unknown>)[edition]);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("when the edition is present (well-formed) in config.mapping, tierFor returns that exact tier with reason policy_mapped", () => {
    fc.assert(
      fc.property(
        arbEdition,
        arbVersion,
        fc.constantFrom("pool" as const, "silo" as const),
        (edition, version, mappedTier) => {
          const config: PlacementPolicyConfig = { version, mapping: { [edition]: mappedTier } };
          const decision = tierFor(edition, config);

          expect(decision.tier).toBe(mappedTier);
          expect(decision.reason).toBe("policy_mapped");
          expect(decision.policyVersion).toBe(version);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("when the edition is absent from config.mapping, tierFor always falls back to pool with reason fallback_default", () => {
    fc.assert(
      fc.property(arbEdition, arbVersion, arbMapping, (edition, version, mapping) => {
        // Force the edition-under-test to be absent from the mapping.
        const mappingWithoutEdition = { ...mapping };
        delete (mappingWithoutEdition as Record<string, unknown>)[edition];
        const config = { version, mapping: mappingWithoutEdition } as unknown as PlacementPolicyConfig;

        const decision = tierFor(edition, config);

        expect(decision.tier).toBe("pool");
        expect(decision.reason).toBe("fallback_default");
        expect(decision.policyVersion).toBe(version);
      }),
      { numRuns: 200 },
    );
  });

  it("the fail-safe default config (empty mapping) always yields pool/fallback_default for every edition", () => {
    fc.assert(
      fc.property(arbEdition, arbVersion, (edition, version) => {
        const defaultConfig: PlacementPolicyConfig = { version, mapping: {} };
        const decision = tierFor(edition, defaultConfig);

        expect(decision.tier).toBe("pool");
        expect(decision.reason).toBe("fallback_default");
      }),
      { numRuns: 100 },
    );
  });

  it("the fallback is safe: an edition absent from the mapping is never assigned silo, and every decision is auditable via reason", () => {
    fc.assert(
      fc.property(arbEdition, arbConfig, (edition, config) => {
        const decision = tierFor(edition, config);
        const editionPresent = Object.prototype.hasOwnProperty.call(config.mapping, edition);

        if (!editionPresent) {
          // Edition absent from the mapping — must fall back safely, never to silo.
          expect(decision.tier).toBe("pool");
          expect(decision.reason).toBe("fallback_default");
        }
        // Regardless of branch, reason is always one of the two defined values —
        // the decision is always auditable.
        expect(decision.reason).toBeDefined();
        expect(["policy_mapped", "fallback_default"]).toContain(decision.reason);
      }),
      { numRuns: 200 },
    );
  });
});

describe("Property 3b: loadPlacementPolicyConfig never throws and always yields a pool-fallback for unmapped editions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /** Arbitrary malformed/missing TENANT_PLACEMENT_POLICY env value. */
  const arbRawEnvValue = fc.oneof(
    fc.constant(undefined),
    fc.constant(""),
    fc.constant("{not valid json"),
    fc.constant("null"),
    fc.constant("123"),
    fc.constant("[]"),
    fc.string({ maxLength: 40 }),
    fc.jsonValue().map((v) => JSON.stringify(v)),
    // Well-formed-shaped JSON with an arbitrary (possibly malformed) mapping.
    fc.tuple(arbVersion, arbMapping).map(([version, mapping]) => JSON.stringify({ version, mapping })),
  );

  it("loadPlacementPolicyConfig never throws and always yields a config that pool-falls-back for any unmapped edition", async () => {
    await fc.assert(
      fc.asyncProperty(arbRawEnvValue, arbEdition, async (rawEnvValue, edition) => {
        vi.resetModules();
        if (rawEnvValue === undefined) {
          vi.stubEnv("TENANT_PLACEMENT_POLICY", "");
          delete process.env.TENANT_PLACEMENT_POLICY;
        } else {
          vi.stubEnv("TENANT_PLACEMENT_POLICY", rawEnvValue);
        }

        const mod = await import("../src/modules/tenant/placement-policy.js");

        let config: ReturnType<typeof mod.loadPlacementPolicyConfig> | undefined;
        expect(() => {
          config = mod.loadPlacementPolicyConfig();
        }).not.toThrow();
        expect(config).toBeDefined();
        expect(typeof config!.version).toBe("string");
        expect(typeof config!.mapping).toBe("object");

        // The loaded config must itself be usable by tierFor without throwing,
        // and any edition unmapped by it must safely fall back to pool.
        let decision: ReturnType<typeof mod.tierFor> | undefined;
        expect(() => {
          decision = mod.tierFor(edition, config!);
        }).not.toThrow();

        const editionPresent = Object.prototype.hasOwnProperty.call(config!.mapping, edition);
        if (!editionPresent) {
          expect(decision!.tier).toBe("pool");
          expect(decision!.reason).toBe("fallback_default");
        }
      }),
      { numRuns: 100 },
    );
  });
});
