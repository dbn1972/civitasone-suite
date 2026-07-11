/**
 * config-registry — pure domain + policy tests (no I/O).
 *
 * Covers id determinism, namespace/key validation, the effectiveAllowed resolver
 * (including the configured-empty sentinel), and the worker-path policy resolvers
 * (resolveNumber / resolveEscalationChain default vs override).
 */
import { describe, it, expect } from "vitest";
import {
  deriveConfigId,
  deterministicId,
  assertValidNamespace,
  assertValidKey,
  effectiveAllowed,
  CONFIGURED_EMPTY_SENTINEL,
} from "../src/modules/config-registry/domain.js";
import {
  POLICY_DEFAULTS,
  resolveNumber,
  resolveEscalationChain,
  DEFAULT_COMMITTEE_TYPES,
  toNumber,
} from "../src/modules/config-registry/policy.js";

const TENANT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-0000-4000-8000-000000000002";

describe("config-registry domain — id derivation", () => {
  it("deriveConfigId is deterministic per (tenant, namespace, key)", () => {
    const a = deriveConfigId(TENANT_A, "meeting_policy", "agenda.submission_deadline_days");
    const b = deriveConfigId(TENANT_A, "meeting_policy", "agenda.submission_deadline_days");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("differs across tenant / namespace / key", () => {
    const base = deriveConfigId(TENANT_A, "meeting_policy", "k");
    expect(deriveConfigId(TENANT_B, "meeting_policy", "k")).not.toBe(base);
    expect(deriveConfigId(TENANT_A, "meeting_other", "k")).not.toBe(base);
    expect(deriveConfigId(TENANT_A, "meeting_policy", "k2")).not.toBe(base);
  });

  it("deterministicId emits a v5 UUID", () => {
    expect(deterministicId(deriveConfigId(TENANT_A, "n", "k"), "x")).toMatch(/-5[0-9a-f]{3}-/);
  });
});

describe("config-registry domain — validation", () => {
  it("accepts valid namespaces + keys", () => {
    expect(() => assertValidNamespace("meeting_policy")).not.toThrow();
    expect(() => assertValidKey("agenda.submission_deadline_days")).not.toThrow();
  });
  it("rejects invalid namespaces + keys", () => {
    expect(() => assertValidNamespace("Meeting")).toThrow(/INVALID_CONFIG_NAMESPACE/);
    expect(() => assertValidNamespace("x")).toThrow();
    expect(() => assertValidKey("bad key!")).toThrow(/INVALID_CONFIG_KEY/);
    expect(() => assertValidKey("")).toThrow();
  });
});

describe("config-registry domain — effectiveAllowed", () => {
  const fallback = ["standing", "ad_hoc", "statutory", "board"];
  it("empty configured set → fallback default (authoritative)", () => {
    expect([...effectiveAllowed([], fallback)].sort()).toEqual([...fallback].sort());
  });
  it("non-empty configured set REPLACES the default", () => {
    expect(effectiveAllowed(["statutory"], fallback)).toEqual(new Set(["statutory"]));
  });
  it("sentinel expresses the EXPLICIT empty set (not the default)", () => {
    expect(effectiveAllowed([CONFIGURED_EMPTY_SENTINEL], fallback)).toEqual(new Set());
    expect(effectiveAllowed([CONFIGURED_EMPTY_SENTINEL, "board"], fallback)).toEqual(new Set());
  });
});

describe("config-registry policy — worker-path resolvers", () => {
  it("resolveNumber falls back to the literal default when unconfigured", () => {
    const empty = new Map<string, Map<string, unknown>>();
    expect(resolveNumber(empty, TENANT_A, "committee.tenure_advance_notice_days"))
      .toBe(POLICY_DEFAULTS["committee.tenure_advance_notice_days"]);
  });
  it("resolveNumber uses the tenant override when present", () => {
    const overrides = new Map([[TENANT_A, new Map<string, unknown>([["committee.tenure_advance_notice_days", 45]])]]);
    expect(resolveNumber(overrides, TENANT_A, "committee.tenure_advance_notice_days")).toBe(45);
    // A different tenant still gets the default.
    expect(resolveNumber(overrides, TENANT_B, "committee.tenure_advance_notice_days")).toBe(30);
  });
  it("resolveEscalationChain defaults to 24/72/168h, override wins per rung", () => {
    const def = resolveEscalationChain(new Map(), TENANT_A);
    expect(def.map((r) => r.afterDeadlineHours)).toEqual([24, 72, 168]);
    const overrides = new Map([[TENANT_A, new Map<string, unknown>([["action_item.escalation_l1_hours", 12]])]]);
    expect(resolveEscalationChain(overrides, TENANT_A).map((r) => r.afterDeadlineHours)).toEqual([12, 72, 168]);
  });
  it("toNumber coerces strings and wrapped values, rejects junk", () => {
    expect(toNumber(7)).toBe(7);
    expect(toNumber("7")).toBe(7);
    expect(toNumber({ value: 9 })).toBe(9);
    expect(toNumber("nope")).toBeUndefined();
    expect(toNumber(null)).toBeUndefined();
  });
  it("DEFAULT_COMMITTEE_TYPES mirrors the committee domain vocabulary", () => {
    expect([...DEFAULT_COMMITTEE_TYPES].sort()).toEqual(["ad_hoc", "board", "standing", "statutory"]);
  });
});
