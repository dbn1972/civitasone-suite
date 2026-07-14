/**
 * Unit tests for the config-registry pure domain + policy layer, and for the
 * migrated (previously-hardcoded) knobs' config-driven parameters. No DB — these
 * exercise the deterministic pieces that make the migration behavior-preserving
 * by default and tenant-overridable when configured.
 */
import { describe, it, expect } from "vitest";
import {
  deterministicId,
  deriveConfigId,
  effectiveAllowed,
  CONFIGURED_EMPTY_SENTINEL,
  assertValidNamespace,
  assertValidKey,
  VISITOR_NAMESPACE,
} from "../src/modules/config-registry/domain.js";
import {
  toNumber,
  toBoolean,
  resolveNumber,
  resolveBoolean,
  minThresholdMs,
  POLICY_DEFAULTS,
  POLICY_BOOL_DEFAULTS,
  DEFAULT_AUTO_APPROVE_CATEGORIES,
  MS_PER_DAY,
} from "../src/modules/config-registry/policy.js";
import { resolveInitialStatus } from "../src/modules/visit-request/domain.js";
import { computeValidityWindow, MULTI_DAY_MAX_MS } from "../src/modules/digital-pass/domain.js";
import { isOverstayed } from "../src/modules/check-in/domain.js";
import { isTailgating, isPassageAllowed } from "../src/modules/turnstile-control/domain.js";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

describe("config-registry domain", () => {
  it("deriveConfigId is deterministic per (tenant, namespace, key) and tenant-scoped", () => {
    const id1 = deriveConfigId(A, "visitor_policy", "retention.pii_days");
    const id2 = deriveConfigId(A, "visitor_policy", "retention.pii_days");
    const idOtherTenant = deriveConfigId(B, "visitor_policy", "retention.pii_days");
    const idOtherKey = deriveConfigId(A, "visitor_policy", "visit_request.no_show_hours");
    expect(id1).toBe(id2);
    expect(id1).not.toBe(idOtherTenant);
    expect(id1).not.toBe(idOtherKey);
    expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("deterministicId is a stable UUIDv5", () => {
    expect(deterministicId(VISITOR_NAMESPACE, "x")).toBe(deterministicId(VISITOR_NAMESPACE, "x"));
  });

  it("effectiveAllowed: tenant config REPLACES the default set (authoritative)", () => {
    // No tenant config → default set applies.
    expect(effectiveAllowed([], ["vip"])).toEqual(new Set(["vip"]));
    // Tenant configured a set → it fully replaces the default (adds + restricts).
    expect(effectiveAllowed(["vip", "contractor"], ["vip"])).toEqual(new Set(["vip", "contractor"]));
    expect(effectiveAllowed(["delegation"], ["vip"])).toEqual(new Set(["delegation"]));
  });

  it("effectiveAllowed: unset → default {vip}; configured-empty (sentinel) → ∅; explicit set replaces", () => {
    // Fix 4 — a tenant CAN configure the empty set (auto-approve nobody) via the
    // reserved sentinel key, distinct from the unset case (→ default).
    // Unset → module default.
    expect(effectiveAllowed([], ["vip"])).toEqual(new Set(["vip"]));
    // Configured-empty via the reserved sentinel → the EXPLICIT empty set (∅):
    // everyone requires approval; the default {vip} is NOT re-applied.
    expect(effectiveAllowed([CONFIGURED_EMPTY_SENTINEL], ["vip"])).toEqual(new Set());
    // Sentinel mixed with other keys still means "explicit empty" (unambiguous intent).
    expect(effectiveAllowed([CONFIGURED_EMPTY_SENTINEL, "vip"], ["vip"])).toEqual(new Set());
    // A genuine configured set (no sentinel) replaces the default.
    expect(effectiveAllowed(["vip", "contractor"], ["vip"])).toEqual(new Set(["vip", "contractor"]));
    // The sentinel is pattern-valid so it survives assertValidKey (config.set path).
    expect(() => assertValidKey(CONFIGURED_EMPTY_SENTINEL)).not.toThrow();
  });

  it("namespace/key validators accept valid and reject invalid", () => {
    expect(() => assertValidNamespace("visitor_policy")).not.toThrow();
    expect(() => assertValidNamespace("Visitor")).toThrow(/INVALID_CONFIG_NAMESPACE/);
    expect(() => assertValidKey("visit_request.reminder_hours")).not.toThrow();
    expect(() => assertValidKey("bad key!")).toThrow(/INVALID_CONFIG_KEY/);
  });
});

describe("config-registry policy coercion + resolution", () => {
  it("POLICY_BOOL_DEFAULTS carries the check-in auto-print-badge toggle (default ON)", () => {
    expect(POLICY_BOOL_DEFAULTS["check_in.auto_print_badge"]).toBe(true);
    expect(POLICY_BOOL_DEFAULTS["turnstile.anti_passback_enabled"]).toBe(true);
  });

  it("toNumber coerces number/string/wrapped and rejects junk", () => {
    expect(toNumber(365)).toBe(365);
    expect(toNumber("30")).toBe(30);
    expect(toNumber({ value: 7 })).toBe(7);
    expect(toNumber("nope")).toBeUndefined();
    expect(toNumber(null)).toBeUndefined();
  });

  it("toBoolean coerces boolean/string/wrapped", () => {
    expect(toBoolean(false)).toBe(false);
    expect(toBoolean("true")).toBe(true);
    expect(toBoolean({ value: false })).toBe(false);
    expect(toBoolean(3)).toBeUndefined();
  });

  it("resolveNumber falls back to the documented DEFAULT when unconfigured", () => {
    const overrides = new Map<string, Map<string, unknown>>();
    overrides.set(A, new Map([["retention.pii_days", 1]]));
    expect(resolveNumber(overrides, A, "retention.pii_days")).toBe(1); // A override
    expect(resolveNumber(overrides, B, "retention.pii_days")).toBe(POLICY_DEFAULTS["retention.pii_days"]); // B default 365
  });

  it("resolveBoolean falls back to the documented DEFAULT", () => {
    const overrides = new Map<string, Map<string, unknown>>();
    overrides.set(A, new Map([["turnstile.anti_passback_enabled", false]]));
    expect(resolveBoolean(overrides, A, "turnstile.anti_passback_enabled")).toBe(false);
    expect(resolveBoolean(overrides, B, "turnstile.anti_passback_enabled")).toBe(
      POLICY_BOOL_DEFAULTS["turnstile.anti_passback_enabled"],
    );
  });

  it("minThresholdMs widens the scan to the smallest configured threshold", () => {
    const overrides = new Map<string, Map<string, unknown>>();
    overrides.set(A, new Map([["retention.pii_days", 1]]));
    // default 365d, A override 1d → widest scan is 1 day.
    expect(minThresholdMs(overrides, "retention.pii_days", MS_PER_DAY)).toBe(1 * MS_PER_DAY);
    // no overrides → default.
    expect(minThresholdMs(new Map(), "retention.pii_days", MS_PER_DAY)).toBe(365 * MS_PER_DAY);
  });
});

describe("migrated knob: approval policy (resolveInitialStatus)", () => {
  it("defaults to {vip} bypass, everyone else pending", () => {
    expect(DEFAULT_AUTO_APPROVE_CATEGORIES).toContain("vip");
    expect(resolveInitialStatus("portal", "vip")).toBe("approved");
    expect(resolveInitialStatus("portal", "contractor")).toBe("pending_approval");
    expect(resolveInitialStatus("host_preregister", "standard")).toBe("pre_approved");
  });

  it("a tenant auto-approve set that includes contractor auto-approves contractors", () => {
    const tenantSet = new Set(["vip", "contractor"]);
    expect(resolveInitialStatus("portal", "contractor", tenantSet)).toBe("approved");
    expect(resolveInitialStatus("portal", "vip", tenantSet)).toBe("approved");
    // A set that REPLACES the default (no vip) makes vip pending again.
    expect(resolveInitialStatus("portal", "vip", new Set(["contractor"]))).toBe("pending_approval");
  });
});

describe("migrated knob: pass validity caps (computeValidityWindow)", () => {
  const from = new Date("2026-01-01T09:00:00Z");
  it("multi_day defaults to the 7-day cap", () => {
    const until = new Date("2026-02-01T09:00:00Z"); // 31 days out
    const { validUntil } = computeValidityWindow("multi_day", from, until);
    expect(validUntil.getTime()).toBe(from.getTime() + MULTI_DAY_MAX_MS);
  });
  it("a tenant multi-day cap override binds", () => {
    const until = new Date("2026-02-01T09:00:00Z");
    const { validUntil } = computeValidityWindow("multi_day", from, until, { multiDayMaxMs: 2 * MS_PER_DAY });
    expect(validUntil.getTime()).toBe(from.getTime() + 2 * MS_PER_DAY);
  });
  it("recurring defaults to the 90-day cap and honors an override", () => {
    const until = new Date("2026-12-01T09:00:00Z"); // ~334 days out
    const dflt = computeValidityWindow("recurring", from, until);
    expect(dflt.validUntil.getTime()).toBe(from.getTime() + 90 * MS_PER_DAY);
    const capped = computeValidityWindow("recurring", from, until, { recurringMaxMs: 30 * MS_PER_DAY });
    expect(capped.validUntil.getTime()).toBe(from.getTime() + 30 * MS_PER_DAY);
  });
});

describe("migrated knob: overstay grace (isOverstayed)", () => {
  const validUntil = new Date("2026-01-01T10:00:00Z");
  it("defaults to zero grace (unchanged behavior)", () => {
    expect(isOverstayed(new Date("2026-01-01T10:00:01Z"), validUntil)).toBe(true);
    expect(isOverstayed(new Date("2026-01-01T10:00:00Z"), validUntil)).toBe(false);
  });
  it("a grace period defers overstay until grace elapses", () => {
    const grace = 15 * 60_000;
    expect(isOverstayed(new Date("2026-01-01T10:10:00Z"), validUntil, grace)).toBe(false); // within grace
    expect(isOverstayed(new Date("2026-01-01T10:16:00Z"), validUntil, grace)).toBe(true); // past grace
  });
});

describe("migrated knob: turnstile tolerance + anti-passback", () => {
  it("tailgating defaults to tolerance 1; override widens", () => {
    expect(isTailgating(2)).toBe(true);
    expect(isTailgating(2, 2)).toBe(false);
    expect(isTailgating(3, 2)).toBe(true);
  });
  it("anti-passback default enforced; disabling allows repeats", () => {
    const repeat = { passId: "p", requestedDirection: "in" as const, lastKnownDirection: "in" as const };
    expect(isPassageAllowed(repeat)).toBe(false); // enforced by default
    expect(isPassageAllowed(repeat, false)).toBe(true); // disabled → allowed
  });
});
