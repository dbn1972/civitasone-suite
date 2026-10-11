/**
 * Workforce Core backfill — tenant.positions reader (ST-M01-08).
 * Malformed rows must fail the load closed, never be dropped silently.
 */
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePositions, readPositionsFromFile } from "../src/modules/workforce-core/backfill-positions.js";

const good = { id: "p1", orgUnitId: "o1", code: "C1", title: "Clerk", grade: "L4", status: "active" };

describe("parsePositions", () => {
  it("maps well-formed rows (array and {data})", () => {
    expect(parsePositions([good])).toHaveLength(1);
    expect(parsePositions({ data: [good] })[0]?.code).toBe("C1");
  });

  it("throws on a malformed row instead of dropping it", () => {
    expect(() => parsePositions([good, { id: "p2", title: "No code", status: "active" }])).toThrow(/row #1 is malformed.*code/);
    expect(() => parsePositions([null])).toThrow(/row #0/);
  });

  it("throws when status is missing rather than defaulting to active", () => {
    const { status: _s, ...noStatus } = good;
    expect(() => parsePositions([noStatus])).toThrow(/missing status/);
  });
});

describe("readPositionsFromFile", () => {
  it("fails closed on a two-row file with one bad row", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wc-pos-"));
    try {
      const f = join(dir, "positions.json");
      await writeFile(f, JSON.stringify({ data: [good, { id: "p2" }] }));
      await expect(readPositionsFromFile(f)).rejects.toThrow(/malformed/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
