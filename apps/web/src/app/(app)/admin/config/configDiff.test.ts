import { describe, it, expect } from "vitest";
import { buildConfigPatch, toFormValues, type PlatformControllable } from "./configDiff";

const server: PlatformControllable = {
  cacheTtl: { finance: 60, hrms: 30 },
  rateLimits: { perMinute: 100, burstMax: 20 },
  logLevel: "info",
  debugModeUntil: null,
  notifications: { emailProvider: "smtp", smsProvider: "none", emailFrom: "noreply@civitasone.in", smsFrom: "CIVONE" },
};

// GAP-ADMIN-CONFIG-01 / 03
describe("buildConfigPatch", () => {
  it("returns an empty patch when nothing changed (Save stays disabled)", () => {
    const v = toFormValues(server);
    expect(buildConfigPatch(v, v)).toEqual({ ok: true, patch: {} });
  });
  it("sends only the changed field", () => {
    const v = toFormValues(server);
    const r = buildConfigPatch(v, { ...v, logLevel: "warn" });
    expect(r).toEqual({ ok: true, patch: { logLevel: "warn" } });
  });
  it("nests rate limit and cache changes the way the API's strict schema expects", () => {
    const v = toFormValues(server);
    const r = buildConfigPatch(v, { ...v, perMinute: "250", cacheTtl: { ...v.cacheTtl, finance: "120" } });
    expect(r).toEqual({ ok: true, patch: { rateLimits: { perMinute: 250 }, cacheTtl: { finance: 120 } } });
  });
  it("enforces the server's bounds client-side and never coerces empty to 0", () => {
    const v = toFormValues(server);
    const r = buildConfigPatch(v, { ...v, perMinute: "", burstMax: "2", cacheTtl: { ...v.cacheTtl, finance: "99999" }, emailFrom: "nope" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["burstMax", "cacheTtl.finance", "emailFrom", "perMinute"]);
  });
  it("never emits a field the API does not know (the old form's platformName etc.)", () => {
    const v = toFormValues(server);
    const r = buildConfigPatch(v, { ...v, logLevel: "debug", smsFrom: "X" });
    if (r.ok) for (const k of Object.keys(r.patch)) expect(["logLevel", "rateLimits", "cacheTtl", "notifications"]).toContain(k);
  });
});
