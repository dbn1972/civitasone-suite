/**
 * Regression coverage for the reference-number collision bug fixed by
 * migrations/0002_number_sequences.sql, mirrored directly from
 * inspection-service's own reference test
 * (tests/encroachment-illegal-construction-number-sequences.test.ts) —
 * same bug shape (Date.now()-based generation, no DB-level uniqueness
 * guarantee), same fix shape (a real Postgres SEQUENCE + a pure formatter).
 *
 * The DB-backed tests below intentionally do NOT mock ../src/shared/db.js —
 * they hit the real Postgres configured by vitest.config.ts's DATABASE_URL.
 * Two independent, freshly-opened `postgres` client connections are used
 * (rather than the app's shared pool) to simulate two independent
 * processes/replicas each asking for a number — exactly the failure mode
 * the old Date.now() scheme was vulnerable to.
 */
import { describe, it, expect, afterAll } from "vitest";
import postgres from "postgres";
import { db } from "../src/shared/db.js";
import { formatComplaintNumber } from "../src/modules/complaints/domain.js";
import { nextComplaintNumber } from "../src/modules/complaints/repo.js";
import { formatRequestNumber } from "../src/modules/tree_requests/domain.js";
import { nextRequestNumber } from "../src/modules/tree_requests/repo.js";
import { formatAssetCode } from "../src/modules/assets/domain.js";
import { nextAssetCode } from "../src/modules/assets/repo.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://parks_svc:parks_dev_pw@localhost:5435/civitas_parks";

describe("reference-number formatters (pure, no DB/IO)", () => {
  it("formatComplaintNumber uses the PRK- prefix", () => {
    expect(formatComplaintNumber(1)).toBe("PRK-1");
    expect(formatComplaintNumber(42)).toBe("PRK-42");
  });

  it("formatRequestNumber uses the PRKT- prefix", () => {
    expect(formatRequestNumber(7)).toBe("PRKT-7");
  });

  it("formatAssetCode uses the PRKA- prefix", () => {
    expect(formatAssetCode(9)).toBe("PRKA-9");
  });

  it("is a pure function of its input — same seq always formats identically, no hidden state", () => {
    expect(formatComplaintNumber(5)).toBe(formatComplaintNumber(5));
    expect(formatRequestNumber(5)).toBe(formatRequestNumber(5));
    expect(formatAssetCode(5)).toBe(formatAssetCode(5));
  });
});

describe("DB-backed number generators — no collision across independent connections", () => {
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
    const first = formatComplaintNumber(await db.transaction((tx) => nextComplaintNumber(tx)));

    // A second, totally independent connection — nothing shares JS
    // process/module state with the first call. Under the old
    // `PRK-${Date.now()}` design, two calls within the same millisecond
    // (a real occurrence under concurrent load) would have reproduced the
    // exact same value.
    const secondClient = freshConnection();
    const [{ seq }] = await secondClient`SELECT nextval('"civitas_parks"."complaint_number_seq"')::bigint AS seq`;
    const second = formatComplaintNumber(Number(seq));

    expect(second).not.toBe(first);
    expect(first).toMatch(/^PRK-\d+$/);
    expect(second).toMatch(/^PRK-\d+$/);
  });

  it("nextRequestNumber issues strictly distinct numbers across independent connections", async () => {
    const first = formatRequestNumber(await db.transaction((tx) => nextRequestNumber(tx)));

    const secondClient = freshConnection();
    const [{ seq }] = await secondClient`SELECT nextval('"civitas_parks"."request_number_seq"')::bigint AS seq`;
    const second = formatRequestNumber(Number(seq));

    expect(second).not.toBe(first);
  });

  it("nextAssetCode issues strictly distinct numbers across independent connections", async () => {
    const first = formatAssetCode(await db.transaction((tx) => nextAssetCode(tx)));

    const secondClient = freshConnection();
    const [{ seq }] = await secondClient`SELECT nextval('"civitas_parks"."asset_code_seq"')::bigint AS seq`;
    const second = formatAssetCode(Number(seq));

    expect(second).not.toBe(first);
  });

  it("repeated calls within one connection are monotonically increasing (never repeat)", async () => {
    const a = formatComplaintNumber(await db.transaction((tx) => nextComplaintNumber(tx)));
    const b = formatComplaintNumber(await db.transaction((tx) => nextComplaintNumber(tx)));
    const c = formatComplaintNumber(await db.transaction((tx) => nextComplaintNumber(tx)));
    const seqOf = (formatted: string) => Number(formatted.split("-").pop());

    expect(seqOf(b)).toBeGreaterThan(seqOf(a));
    expect(seqOf(c)).toBeGreaterThan(seqOf(b));
  });

  it("simulates the exact old failure mode: two 'requests' in the same millisecond now get distinct numbers, not the same one", async () => {
    // The old code was `PRK-${Date.now()}` — two calls with Date.now()
    // stubbed to return the same value would have produced an identical
    // complaintNumber. The sequence-backed replacement takes no wall-clock
    // input at all, so it cannot repeat this failure by construction; this
    // test asserts that directly rather than trying to win a real race.
    const now = Date.now();
    const oldSchemeA = `PRK-${now}`;
    const oldSchemeB = `PRK-${now}`;
    expect(oldSchemeA).toBe(oldSchemeB); // the bug, restated: same ms -> same number

    const newA = formatComplaintNumber(await db.transaction((tx) => nextComplaintNumber(tx)));
    const newB = formatComplaintNumber(await db.transaction((tx) => nextComplaintNumber(tx)));
    expect(newA).not.toBe(newB); // the fix: never repeats, regardless of timing
  });
});
