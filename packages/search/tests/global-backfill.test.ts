import { describe, it, expect } from "vitest";
import { runBackfill, parseBackfillArgs, type GlobalSearchRecordInput } from "../src/global/index.js";

const T = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const idN = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function source(n: number, tenantOf: (i: number) => string = () => T) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: idN(i + 1), tenantId: tenantOf(i + 1), name: `Vendor ${i + 1}` }));
  return {
    tenantId: T,
    idOf: (r: { id: string }) => r.id,
    fetchPage: async (after: string | null, size: number) => rows.filter((r) => after === null || r.id > after).slice(0, size),
    toRecord: (r: { id: string; tenantId: string; name: string }): GlobalSearchRecordInput => ({ entityType: "finance.vendor", entityId: r.id, tenantId: r.tenantId, title: r.name, status: "active" }),
  };
}

describe("runBackfill", () => {
  it("dry run reads and validates but writes nothing", async () => {
    const r = await runBackfill(source(7), { sink: null, pageSize: 3 });
    expect(r).toMatchObject({ dryRun: true, scanned: 7, indexed: 7, done: true, lastId: idN(7) });
  });
  it("writes every document with the apply sink", async () => {
    const written: string[] = [];
    const r = await runBackfill(source(7), { sink: async (d) => void written.push(...d.map((x) => x.entityId)), pageSize: 3 });
    expect(r.dryRun).toBe(false);
    expect(written).toHaveLength(7);
  });
  it("is capped and resumable: two capped runs cover everything exactly once", async () => {
    const seen: string[] = [];
    const sink = async (d: Array<{ entityId: string }>) => void seen.push(...d.map((x) => x.entityId));
    const first = await runBackfill(source(10), { sink, pageSize: 4, maxRecords: 6 });
    expect(first).toMatchObject({ scanned: 6, done: false, lastId: idN(6) });
    const second = await runBackfill(source(10), { sink, pageSize: 4, maxRecords: 6, afterId: first.lastId });
    expect(second).toMatchObject({ scanned: 4, done: true });
    expect(seen).toEqual(Array.from({ length: 10 }, (_, i) => idN(i + 1)));
  });
  it("never indexes a row of another tenant", async () => {
    const written: string[] = [];
    const r = await runBackfill(source(5, (i) => (i === 3 ? OTHER : T)), { sink: async (d) => void written.push(...d.map((x) => x.tenantId)), pageSize: 10 });
    expect(r).toMatchObject({ scanned: 5, indexed: 4, skipped: 1 });
    expect(new Set(written)).toEqual(new Set([T]));
  });
  it("counts redactions of personal-looking data", async () => {
    const src = source(1);
    const r = await runBackfill({ ...src, toRecord: (row) => ({ ...src.toRecord(row), title: "ABCDE1234F Traders" }) }, { sink: null });
    expect(r.redactions).toBe(1);
  });
});

describe("parseBackfillArgs", () => {
  it("defaults to a dry run with a cap", () => {
    expect(parseBackfillArgs(["--", "--tenant", T])).toEqual({ tenantId: T, apply: false, limit: 5000, after: null, purge: false, only: null });
  });
  it("parses apply/limit/after/purge", () => {
    expect(parseBackfillArgs(["--tenant", T, "--apply", "--limit", "20", "--after", idN(3), "--only", "finance.bill", "--purge"])).toEqual({ tenantId: T, apply: true, limit: 20, after: idN(3), purge: true, only: "finance.bill" });
  });
  it("rejects bad input", () => {
    expect(() => parseBackfillArgs([])).toThrow();
    expect(() => parseBackfillArgs(["--tenant", "nope"])).toThrow();
    expect(() => parseBackfillArgs(["--tenant", T, "--limit", "0"])).toThrow();
    expect(() => parseBackfillArgs(["--tenant", T, "--after", "x"])).toThrow();
    expect(() => parseBackfillArgs(["--tenant", T, "--after", idN(3)])).toThrow(/--only/);
  });
});
