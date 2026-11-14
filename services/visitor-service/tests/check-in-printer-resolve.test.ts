/**
 * Badge printer resolution at check-in. The producer must never publish an empty / non-UUID device id
 * (`PostgresError: invalid input syntax for type uuid: ""` dead-lettered every print job).
 */
import { describe, expect, it } from "vitest";
import { resolveBadgePrinter, isUuid } from "../src/modules/check-in/printer.js";

const TENANT = "11111111-1111-1111-1111-111111111111";
const GATE = "55555555-5555-5555-5555-555555555555";
const TERMINAL = "99999999-9999-9999-9999-999999999999";
const GATE_PRINTER = "88888888-8888-8888-8888-888888888888";

/** select() calls return the queued row-sets in order; both chain shapes (with/without orderBy) work. */
function fakeTx(...rowSets: Array<Array<Record<string, unknown>>>) {
  let n = 0;
  const calls: number[] = [];
  return {
    calls,
    select: () => {
      const rows = rowSets[n++] ?? [];
      calls.push(n);
      const limit = async () => rows;
      return { from: () => ({ where: () => ({ limit, orderBy: () => ({ limit }) }) }) };
    },
  };
}

describe("isUuid", () => {
  it("accepts uuids and rejects empty / free-text ids", () => {
    expect(isUuid(TERMINAL)).toBe(true);
    expect(isUuid("")).toBe(false);
    expect(isUuid("gate-terminal-1")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});

describe("resolveBadgePrinter", () => {
  it("uses the supplied gateTerminalId when it is a live device of the tenant", async () => {
    const tx = fakeTx([{ id: TERMINAL, deviceType: "printer", capabilities: {} }]);
    expect(await resolveBadgePrinter(tx, TENANT, GATE, TERMINAL)).toEqual({ deviceId: TERMINAL, source: "terminal" });
  });

  it("does not treat a scanner / turnstile terminal as a printer: falls back to the gate printer", async () => {
    const tx = fakeTx([{ id: TERMINAL, deviceType: "turnstile", capabilities: { qr: ["scan"] } }], [{ id: GATE_PRINTER }]);
    expect(await resolveBadgePrinter(tx, TENANT, GATE, TERMINAL)).toEqual({ deviceId: GATE_PRINTER, source: "gate_default" });
  });

  it("accepts a kiosk terminal with an attached printer", async () => {
    const tx = fakeTx([{ id: TERMINAL, deviceType: "kiosk", capabilities: { peripherals: ["badge_printer"] } }]);
    expect(await resolveBadgePrinter(tx, TENANT, GATE, TERMINAL)).toEqual({ deviceId: TERMINAL, source: "terminal" });
  });

  it("falls back to the gate's default printer when no terminal is given", async () => {
    const tx = fakeTx([{ id: GATE_PRINTER }]);
    expect(await resolveBadgePrinter(tx, TENANT, GATE, undefined)).toEqual({ deviceId: GATE_PRINTER, source: "gate_default" });
  });

  it("falls back to the gate printer when the terminal id is not a device of this tenant", async () => {
    const tx = fakeTx([], [{ id: GATE_PRINTER }]);
    expect(await resolveBadgePrinter(tx, TENANT, GATE, TERMINAL)).toEqual({ deviceId: GATE_PRINTER, source: "gate_default" });
  });

  it("does not even query for a non-UUID terminal id; goes straight to the gate printer", async () => {
    const tx = fakeTx([{ id: GATE_PRINTER }]);
    const r = await resolveBadgePrinter(tx, TENANT, GATE, "terminal-7");
    expect(r).toEqual({ deviceId: GATE_PRINTER, source: "gate_default" });
    expect(tx.calls).toHaveLength(1);
  });

  it("returns null (never an empty string) with a reason when there is no printer at all", async () => {
    const none = await resolveBadgePrinter(fakeTx([]), TENANT, GATE, null);
    expect(none.deviceId).toBeNull();
    expect((none as { reason: string }).reason).toContain(GATE);
    const empty = await resolveBadgePrinter(fakeTx([]), TENANT, GATE, "");
    expect(empty.deviceId).toBeNull();
  });
});
