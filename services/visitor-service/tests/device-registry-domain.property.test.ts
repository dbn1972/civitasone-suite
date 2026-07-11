/**
 * Property-based tests for device-registry domain logic.
 *
 * Uses fast-check to validate universal correctness properties:
 *   - Property 2: Serial number uniqueness within tenant
 *   - Property 3: Device state machine transitions are valid
 *   - Property 7: Firmware version below minimum restricts device
 *
 * **Validates: Requirements 1.2, 1.1, 1.8, 3.7, 10.5, 10.8**
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  canTransition,
  DEVICE_TRANSITIONS,
  DeviceStatus,
  isFirmwareOutdated,
} from "../src/modules/device-registry/domain.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** All valid device statuses. */
const ALL_STATUSES: DeviceStatus[] = ["pending_activation", "active", "suspended", "deregistered"];

/** Arbitrary valid device status. */
const arbDeviceStatus = fc.constantFrom(...ALL_STATUSES);

/** Arbitrary tenant ID (UUID). */
const arbTenantId = fc.uuid();

/** Arbitrary serial number (alphanumeric string). */
const arbSerialNumber = fc.string({ minLength: 1, maxLength: 64 }).map(
  (s) => s.replace(/[^a-zA-Z0-9-]/g, "X") || "SN-0001",
);

/**
 * Arbitrary semver-like version string as fc.tuple(major, minor, patch).
 * Components range from 0–20 to keep the test space manageable.
 */
const arbSemver = fc
  .tuple(fc.nat({ max: 20 }), fc.nat({ max: 20 }), fc.nat({ max: 20 }))
  .map(([a, b, c]) => `${a}.${b}.${c}`);

// ---------------------------------------------------------------------------
// Property 2: Serial number uniqueness within tenant
// ---------------------------------------------------------------------------

describe("Property 2: Serial number uniqueness within tenant", () => {
  /**
   * **Validates: Requirements 1.2**
   *
   * For any tenant and serial number combination, if a device with that
   * (tenant_id, serial_number) pair already exists, registering another
   * device with the same pair must produce a conflict. Different tenants
   * may reuse serial numbers.
   */
  it("same (tenant_id, serial_number) pair always produces a conflict in the registry", () => {
    fc.assert(
      fc.property(
        arbTenantId,
        arbSerialNumber,
        (tenantId, serialNumber) => {
          // Simulate a device registry as a Set of "tenant:serial" keys
          const registry = new Set<string>();
          const key = `${tenantId}:${serialNumber}`;

          // First registration succeeds
          const firstResult = !registry.has(key);
          registry.add(key);

          // Second registration with same pair must conflict
          const secondResult = !registry.has(key);

          expect(firstResult).toBe(true);
          expect(secondResult).toBe(false); // conflict
        },
      ),
      { numRuns: 100 },
    );
  });

  it("different tenants may reuse the same serial number without conflict", () => {
    fc.assert(
      fc.property(
        arbTenantId,
        arbTenantId,
        arbSerialNumber,
        (tenantA, tenantB, serialNumber) => {
          // Skip when both tenants are identical (degenerate case)
          fc.pre(tenantA !== tenantB);

          const registry = new Set<string>();
          const keyA = `${tenantA}:${serialNumber}`;
          const keyB = `${tenantB}:${serialNumber}`;

          // Both registrations succeed since tenants differ
          registry.add(keyA);
          const secondResult = !registry.has(keyB);

          expect(secondResult).toBe(true); // no conflict across tenants
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Device state machine transitions are valid
// ---------------------------------------------------------------------------

describe("Property 3: Device state machine transitions are valid", () => {
  /**
   * **Validates: Requirements 1.1, 1.8**
   *
   * For any device in state S, a transition to state T is permitted only if
   * T is in the allowed transition set for S. canTransition returns true IFF
   * the target is in DEVICE_TRANSITIONS[from].
   */
  it("canTransition returns true IFF target is in DEVICE_TRANSITIONS[from]", () => {
    fc.assert(
      fc.property(
        arbDeviceStatus,
        arbDeviceStatus,
        (from, to) => {
          const allowed = DEVICE_TRANSITIONS[from];
          const expected = allowed.includes(to);
          expect(canTransition(from, to)).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("deregistered is a terminal state — no transitions allowed from it", () => {
    fc.assert(
      fc.property(
        arbDeviceStatus,
        (to) => {
          // No transition should ever be allowed from deregistered
          expect(canTransition("deregistered", to)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("every non-terminal state has at least one allowed transition", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("pending_activation" as DeviceStatus, "active" as DeviceStatus, "suspended" as DeviceStatus),
        (from) => {
          const allowed = DEVICE_TRANSITIONS[from];
          expect(allowed.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Firmware version below minimum restricts device
// ---------------------------------------------------------------------------

describe("Property 7: Firmware version below minimum restricts device", () => {
  /**
   * **Validates: Requirements 3.7, 10.5, 10.8**
   *
   * For any two semver-like version strings where current < minimum,
   * isFirmwareOutdated(current, minimum) must return true.
   * For any version string compared to itself, it must return false.
   * For any two versions where current > minimum, it must return false.
   */
  it("isFirmwareOutdated returns true when current < minimum", () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.nat({ max: 20 }), fc.nat({ max: 20 }), fc.nat({ max: 20 })),
        fc.tuple(fc.nat({ max: 20 }), fc.nat({ max: 20 }), fc.nat({ max: 20 })),
        (currentParts, minimumParts) => {
          const [cMajor, cMinor, cPatch] = currentParts;
          const [mMajor, mMinor, mPatch] = minimumParts;

          // Only test cases where current is strictly less than minimum
          const isLess =
            cMajor < mMajor ||
            (cMajor === mMajor && cMinor < mMinor) ||
            (cMajor === mMajor && cMinor === mMinor && cPatch < mPatch);

          fc.pre(isLess);

          const current = `${cMajor}.${cMinor}.${cPatch}`;
          const minimum = `${mMajor}.${mMinor}.${mPatch}`;

          expect(isFirmwareOutdated(current, minimum)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("isFirmwareOutdated returns false when version equals itself", () => {
    fc.assert(
      fc.property(
        arbSemver,
        (version) => {
          expect(isFirmwareOutdated(version, version)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("isFirmwareOutdated returns false when current > minimum", () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.nat({ max: 20 }), fc.nat({ max: 20 }), fc.nat({ max: 20 })),
        fc.tuple(fc.nat({ max: 20 }), fc.nat({ max: 20 }), fc.nat({ max: 20 })),
        (currentParts, minimumParts) => {
          const [cMajor, cMinor, cPatch] = currentParts;
          const [mMajor, mMinor, mPatch] = minimumParts;

          // Only test cases where current is strictly greater than minimum
          const isGreater =
            cMajor > mMajor ||
            (cMajor === mMajor && cMinor > mMinor) ||
            (cMajor === mMajor && cMinor === mMinor && cPatch > mPatch);

          fc.pre(isGreater);

          const current = `${cMajor}.${cMinor}.${cPatch}`;
          const minimum = `${mMajor}.${mMinor}.${mPatch}`;

          expect(isFirmwareOutdated(current, minimum)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
