import { describe, expect, it } from "vitest";
import { resolveCheckInTime, FUTURE_SKEW_MS } from "../src/modules/check-in/trusted-time.js";
import { canPrint } from "../src/modules/check-in/printer.js";

const NOW = new Date("2026-11-14T10:00:00.000Z");
const H = 3_600_000;
const LIMIT = 12 * H;

describe("resolveCheckInTime", () => {
  it("a live check-in is judged at server time; the client timestamp is ignored", () => {
    const r = resolveCheckInTime({ timestamp: "2026-11-14T01:00:00.000Z" }, NOW, LIMIT);
    expect(r).toEqual({ ok: true, at: NOW, offline: false });
    expect(resolveCheckInTime({ offlineRecorded: false, timestamp: "2020-01-01T00:00:00Z" }, NOW, LIMIT)).toMatchObject({ ok: true, offline: false });
  });
  it("an offline record uses its own timestamp within [now - limit, now + skew]", () => {
    const r = resolveCheckInTime({ offlineRecorded: true, timestamp: "2026-11-14T00:00:00.000Z" }, NOW, LIMIT);
    expect(r).toMatchObject({ ok: true, offline: true });
    expect(resolveCheckInTime({ offlineRecorded: true, timestamp: new Date(NOW.getTime() + FUTURE_SKEW_MS).toISOString() }, NOW, LIMIT).ok).toBe(true);
  });
  it("refuses too-old, future, missing and unparseable offline timestamps", () => {
    const code = (ts?: string) => { const r = resolveCheckInTime({ offlineRecorded: true, ...(ts ? { timestamp: ts } : {}) }, NOW, LIMIT); return r.ok ? "ok" : r.code; };
    expect(code("2026-11-13T21:59:59.000Z")).toBe("OFFLINE_TIMESTAMP_TOO_OLD");
    expect(code("2026-11-14T10:05:00.000Z")).toBe("OFFLINE_TIMESTAMP_IN_FUTURE");
    expect(code()).toBe("OFFLINE_TIMESTAMP_REQUIRED");
    expect(code("garbage")).toBe("OFFLINE_TIMESTAMP_REQUIRED");
  });
  it("the age limit is the tenant's", () => {
    const ts = "2026-11-14T06:00:00.000Z"; // 4 h old
    expect(resolveCheckInTime({ offlineRecorded: true, timestamp: ts }, NOW, 2 * H).ok).toBe(false);
    expect(resolveCheckInTime({ offlineRecorded: true, timestamp: ts }, NOW, 6 * H).ok).toBe(true);
  });
});

describe("canPrint (gate terminal must be able to print)", () => {
  it("accepts printers and terminals with an attached printer", () => {
    expect(canPrint({ deviceType: "printer", capabilities: {} })).toBe(true);
    expect(canPrint({ deviceType: "kiosk", capabilities: { peripherals: ["badge_printer"] } })).toBe(true);
    expect(canPrint({ deviceType: "kiosk", capabilities: { print: [] } })).toBe(true);
  });
  it("does not mistake fingerprint / blueprint for a printer (whole-word match only)", () => {
    expect(canPrint({ deviceType: "kiosk", capabilities: { fingerprint: ["scan"] } })).toBe(false);
    expect(canPrint({ deviceType: "kiosk", capabilities: { biometrics: ["fingerprint", "blueprint_reader"] } })).toBe(false);
    expect(canPrint({ deviceType: "scanner", capabilities: { sensors: ["fingerprint_scanner"] } })).toBe(false);
  });
  it("still matches print / printer / badge_printer / badgePrinter words", () => {
    expect(canPrint({ deviceType: "kiosk", capabilities: { print: [] } })).toBe(true);
    expect(canPrint({ deviceType: "kiosk", capabilities: { peripherals: ["Badge-Printer"] } })).toBe(true);
    expect(canPrint({ deviceType: "kiosk", capabilities: { badgePrinter: [] } })).toBe(true);
    expect(canPrint({ deviceType: "kiosk", capabilities: { output: ["label printing"] } })).toBe(true);
  });
  it("refuses scanners, turnstiles, barriers and kiosks without a printer", () => {
    for (const deviceType of ["scanner", "turnstile", "barrier", "kiosk"]) expect(canPrint({ deviceType, capabilities: { qr: ["scan"] } })).toBe(false);
    expect(canPrint(undefined)).toBe(false);
    expect(canPrint({ deviceType: "turnstile", capabilities: null })).toBe(false);
  });
});
