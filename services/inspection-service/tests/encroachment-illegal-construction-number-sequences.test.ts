/**
 * Regression coverage for a duplicate-reference-number bug found during
 * deep-verification: generateComplaintNumber/generateNoticeNumber
 * (encroachment/domain.ts) and generateCaseNumber/generateActionNumber
 * (illegal-construction/domain.ts) were plain in-process module-level
 * counters (`let complaintSeq = 0`, etc.) — they reset to 0 on every
 * process restart and were independent per replica in any multi-replica
 * deployment, with no UNIQUE constraint on complaint_number / notice_number
 * / case_number / action_number to catch the resulting collision.
 *
 * Fixed by migration 0028_encroachment_illegal_construction_number_sequences.sql
 * (a UNIQUE constraint on each column, plus one Postgres SEQUENCE per number
 * type) and the paired application change: domain.ts now exports pure
 * formatters only (formatComplaintNumber etc., no side effects, no I/O —
 * matching the module's own documented contract, which the old counters
 * silently violated), and repo.ts's nextComplaintNumber / nextNoticeNumber /
 * nextCaseNumber / nextActionNumber pull the number from Postgres.
 *
 * The DB-backed tests below intentionally do NOT mock ../src/shared/db.js —
 * they hit the real dev Postgres (vitest.config.ts's default DATABASE_URL,
 * postgres://inspection_svc:inspection_dev_pw@localhost:5435/civitas_inspection).
 * The whole point of the bug is where the counter state lives; a mocked db
 * cannot exercise that. Two independent, freshly-opened `postgres` client
 * connections are used (rather than the app's shared pool) to simulate two
 * independent processes/replicas each asking for a number — exactly the
 * failure mode described in the bug report — without touching Node's module
 * cache or leaking connections from the app's own pool.
 */
import { describe, it, expect, afterAll } from "vitest";
import postgres from "postgres";
import { db } from "../src/shared/db.js";
import { formatComplaintNumber, formatNoticeNumber } from "../src/modules/encroachment/domain.js";
import { nextComplaintNumber, nextNoticeNumber } from "../src/modules/encroachment/repo.js";
import { formatCaseNumber, formatActionNumber } from "../src/modules/illegal-construction/domain.js";
import { nextCaseNumber, nextActionNumber } from "../src/modules/illegal-construction/repo.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://inspection_svc:inspection_dev_pw@localhost:5435/civitas_inspection";

describe("reference-number formatters (pure, no DB/IO)", () => {
  const year = new Date().getFullYear();

  it("formatComplaintNumber zero-pads to 6 digits and embeds the current year", () => {
    expect(formatComplaintNumber(1)).toBe(`ENCR-${year}-000001`);
    expect(formatComplaintNumber(42)).toBe(`ENCR-${year}-000042`);
    expect(formatComplaintNumber(123456)).toBe(`ENCR-${year}-123456`);
  });

  it("formatNoticeNumber uses the ENCR-N- prefix", () => {
    expect(formatNoticeNumber(7)).toBe(`ENCR-N-${year}-000007`);
  });

  it("formatCaseNumber uses the ILBLD- prefix", () => {
    expect(formatCaseNumber(3)).toBe(`ILBLD-${year}-000003`);
  });

  it("formatActionNumber uses the ILBLD-A- prefix", () => {
    expect(formatActionNumber(9)).toBe(`ILBLD-A-${year}-000009`);
  });

  it("is a pure function of its input — same seq always formats identically", () => {
    // Guards against a regression back to hidden module-level state: if
    // formatComplaintNumber ever again closed over a mutable counter
    // instead of taking seq as a parameter, calling it twice with the same
    // explicit seq would stop being idempotent.
    expect(formatComplaintNumber(5)).toBe(formatComplaintNumber(5));
    expect(formatCaseNumber(5)).toBe(formatCaseNumber(5));
  });
});

describe("DB-backed number generators — no collision across independent connections", () => {
  // Raw, independent connections (NOT the app's shared pool) — each opened
  // fresh and closed immediately, standing in for "two different
  // processes/replicas". Closed in afterAll so the suite doesn't leak
  // connections against the shared dev DB.
  const clients: ReturnType<typeof postgres>[] = [];
  function freshConnection() {
    const sql = postgres(DATABASE_URL, { max: 1 });
    clients.push(sql);
    return sql;
  }

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.end({ timeout: 5 })));
  });

  it("nextComplaintNumber issues strictly distinct numbers across independent connections", async () => {
    const first = await db.transaction((tx) => nextComplaintNumber(tx));

    // A second, totally independent connection — nothing about it shares
    // JS process/module state with the first call. Under the old
    // `let complaintSeq = 0` design, a fresh process asking for the first
    // complaint number would have reproduced exactly this value.
    const secondClient = freshConnection();
    const [{ seq }] = await secondClient`SELECT nextval('"encroachment"."complaint_number_seq"')::bigint AS seq`;
    const second = formatComplaintNumber(Number(seq));

    expect(second).not.toBe(first);
    expect(first).toMatch(/^ENCR-\d{4}-\d{6,}$/);
    expect(second).toMatch(/^ENCR-\d{4}-\d{6,}$/);
  });

  it("nextNoticeNumber issues strictly distinct numbers across independent connections", async () => {
    const first = await db.transaction((tx) => nextNoticeNumber(tx));

    const secondClient = freshConnection();
    const [{ seq }] = await secondClient`SELECT nextval('"encroachment"."notice_number_seq"')::bigint AS seq`;
    const second = formatNoticeNumber(Number(seq));

    expect(second).not.toBe(first);
    expect(first).toMatch(/^ENCR-N-\d{4}-\d{6,}$/);
    expect(second).toMatch(/^ENCR-N-\d{4}-\d{6,}$/);
  });

  it("nextCaseNumber issues strictly distinct numbers across independent connections", async () => {
    const first = await db.transaction((tx) => nextCaseNumber(tx));

    const secondClient = freshConnection();
    const [{ seq }] = await secondClient`SELECT nextval('"illegal_construction"."case_number_seq"')::bigint AS seq`;
    const second = formatCaseNumber(Number(seq));

    expect(second).not.toBe(first);
    expect(first).toMatch(/^ILBLD-\d{4}-\d{6,}$/);
    expect(second).toMatch(/^ILBLD-\d{4}-\d{6,}$/);
  });

  it("nextActionNumber issues strictly distinct numbers across independent connections", async () => {
    const first = await db.transaction((tx) => nextActionNumber(tx));

    const secondClient = freshConnection();
    const [{ seq }] = await secondClient`SELECT nextval('"illegal_construction"."action_number_seq"')::bigint AS seq`;
    const second = formatActionNumber(Number(seq));

    expect(second).not.toBe(first);
    expect(first).toMatch(/^ILBLD-A-\d{4}-\d{6,}$/);
    expect(second).toMatch(/^ILBLD-A-\d{4}-\d{6,}$/);
  });

  it("repeated calls within one connection are monotonically increasing (never repeat)", async () => {
    const a = await db.transaction((tx) => nextComplaintNumber(tx));
    const b = await db.transaction((tx) => nextComplaintNumber(tx));
    const c = await db.transaction((tx) => nextComplaintNumber(tx));
    const seqOf = (formatted: string) => Number(formatted.split("-").pop());

    expect(seqOf(b)).toBeGreaterThan(seqOf(a));
    expect(seqOf(c)).toBeGreaterThan(seqOf(b));
  });
});
