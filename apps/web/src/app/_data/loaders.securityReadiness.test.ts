import { describe, it, expect } from "vitest";
import { mapSecurityOverview, mapReadiness } from "./loaders";

describe("mapSecurityOverview — GAP-TENANT-ADMIN-SECURITY-02", () => {
  it("accepts a well-formed payload", () => {
    const out = mapSecurityOverview({
      activeSessions: 3,
      failedLogins24h: 1,
      mfaAdoptionRate: 80,
      trustedDevices: 2,
      events: [{ id: "1", timestamp: "2026-01-01T00:00:00Z", type: "login_success", actor: "a@b.in", ipAddress: "1.2.3.4", outcome: "success" }],
    });
    expect(out).not.toBeNull();
    expect(out!.events).toHaveLength(1);
  });

  it("returns null for a payload missing events (so source becomes error, not a throw)", () => {
    const out = mapSecurityOverview({ activeSessions: 1, failedLogins24h: 0, mfaAdoptionRate: 0, trustedDevices: 0 });
    expect(out).toBeNull();
  });

  it("returns null for an empty object", () => {
    expect(mapSecurityOverview({})).toBeNull();
  });

  it("returns null for non-numeric counts", () => {
    expect(
      mapSecurityOverview({ activeSessions: "x", failedLogins24h: 0, mfaAdoptionRate: 0, trustedDevices: 0, events: [] }),
    ).toBeNull();
  });
});

describe("mapReadiness — GAP-TENANT-ADMIN-READINESS-01", () => {
  it("maps the backend gates object into an ordered array", () => {
    const out = mapReadiness({
      overall: 75,
      productionReady: false,
      allGreen: false,
      gates: { queueFirstWrites: true, perfIndexes: false },
    });
    expect(out).not.toBeNull();
    expect(out!.gates).toEqual([
      { key: "queueFirstWrites", passed: true },
      { key: "perfIndexes", passed: false },
    ]);
  });

  it("ignores non-boolean gate values", () => {
    const out = mapReadiness({ overall: 50, gates: { a: true, b: "nope" as unknown as boolean } });
    expect(out!.gates).toEqual([{ key: "a", passed: true }]);
  });

  it("defaults gates to [] when the backend omits them", () => {
    const out = mapReadiness({ overall: 90 });
    expect(out!.gates).toEqual([]);
  });

  it("returns null when overall is absent", () => {
    expect(mapReadiness({ gates: {} })).toBeNull();
  });
});
