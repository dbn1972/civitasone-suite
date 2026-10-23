/**
 * visitor_policy config values are type- and bounds-checked per key. Before, `value`
 * was z.any(), so retention.pii_days = 999999 (or "abc", or -1) was accepted.
 */
import { describe, it, expect } from "vitest";
import { setConfigBody } from "../src/modules/config-registry/validators.js";
import { POLICY_NUMBER_BOUNDS, POLICY_BOOLEAN_KEYS } from "../src/modules/config-registry/domain.js";
import { POLICY_DEFAULTS, POLICY_BOOL_DEFAULTS } from "../src/modules/config-registry/policy.js";
import { VERTICAL_PRESETS } from "../src/modules/config-registry/presets.js";

const body = (configKey: string, value: unknown, namespace = "visitor_policy") => ({ namespace, configKey, value });

describe("visitor_policy value bounds", () => {
  it("rejects an absurd retention.pii_days", () => {
    expect(setConfigBody.safeParse(body("retention.pii_days", 999999)).success).toBe(false);
  });
  it.each([
    ["retention.pii_days", 0], ["retention.pii_days", -5], ["retention.pii_days", 3651], ["retention.pii_days", 1.5],
    ["retention.pii_days", "abc"], ["retention.pii_days", null], ["retention.pii_days", {}], ["retention.pii_days", [30]],
    ["check_in.overstay_escalation_hours", 0], ["check_in.overstay_escalation_hours", 169],
    ["check_in.overstay_grace_minutes", -1], ["check_in.overstay_grace_minutes", 241],
    ["turnstile.tailgating_tolerance", 11],
    ["turnstile.anti_passback_enabled", "yes"], ["turnstile.anti_passback_enabled", 1],
  ])("rejects %s = %j", (k, v) => {
    const r = setConfigBody.safeParse(body(k, v));
    expect(r.success).toBe(false);
  });
  it.each([
    ["retention.pii_days", 1], ["retention.pii_days", 3650], ["retention.pii_days", "180"], ["retention.pii_days", { value: 90 }],
    ["check_in.overstay_grace_minutes", 0], ["check_in.overstay_escalation_hours", 168],
    ["turnstile.anti_passback_enabled", true], ["turnstile.anti_passback_enabled", "false"],
  ])("accepts %s = %j", (k, v) => {
    expect(setConfigBody.safeParse(body(k, v)).success).toBe(true);
  });
  it("only constrains the visitor_policy namespace (approval categories keep free-form values)", () => {
    expect(setConfigBody.safeParse(body("retention.pii_days", 999999, "visitor_approval")).success).toBe(true);
    expect(setConfigBody.safeParse(body("vip", { autoApprove: true }, "visitor_approval")).success).toBe(true);
  });
  it("covers every numeric and boolean policy default, and each default sits inside its bounds", () => {
    for (const [k, v] of Object.entries(POLICY_DEFAULTS)) {
      const b = POLICY_NUMBER_BOUNDS[k];
      expect(b, `bounds for ${k}`).toBeDefined();
      expect(v).toBeGreaterThanOrEqual(b!.min);
      expect(v).toBeLessThanOrEqual(b!.max);
    }
    for (const k of Object.keys(POLICY_BOOL_DEFAULTS)) expect(POLICY_BOOLEAN_KEYS.has(k)).toBe(true);
  });
  it("every built-in preset value still passes validation", () => {
    for (const entries of Object.values(VERTICAL_PRESETS)) {
      for (const e of entries) {
        expect(setConfigBody.safeParse({ namespace: e.namespace, configKey: e.configKey, value: e.value, label: e.label }).success, `${e.configKey}=${JSON.stringify(e.value)}`).toBe(true);
      }
    }
  });
});
