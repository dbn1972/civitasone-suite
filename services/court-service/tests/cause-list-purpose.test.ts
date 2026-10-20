/**
 * GAP-COURT-CAUSE-LIST-04 — the items endpoint returns each item's hearing
 * `purpose` (nullable). Pure picker + the repo read with a faked transaction.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const selects: unknown[][] = [];
let selectCalls = 0;

vi.mock("../src/shared/db.js", () => {
  const chain = (rows: unknown[]) => {
    const c: any = {
      from: () => c, where: () => c,
      orderBy: () => Promise.resolve(rows),
    };
    return c;
  };
  const tx = { select: () => chain(selects[selectCalls++] ?? []) };
  return {
    db: { transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) },
    scopedRead: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  };
});

import { pickItemPurpose } from "../src/modules/cause-list/domain.js";
import { listItemsWithPurpose } from "../src/modules/cause-list/repo.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const LIST = "22222222-2222-4222-8222-222222222222";
const CASE_A = "33333333-3333-4333-8333-333333333333";
const CASE_B = "44444444-4444-4444-8444-444444444444";

const item = (id: string, caseId: string, n: number) => ({
  id, tenantId: TENANT, causeListId: LIST, caseId, itemNumber: n, slot: "AM-1",
  courtroom: "A", listDate: "2026-07-11", version: 1,
});

describe("pickItemPurpose", () => {
  const base = { caseId: CASE_A, purpose: "final_hearing" };
  it("matches the hearing on the list date by IST calendar day", () => {
    // 2026-07-10T20:00Z is 2026-07-11 01:30 IST
    const h = [{ ...base, scheduledDate: new Date("2026-07-10T20:00:00Z") }];
    expect(pickItemPurpose({ caseId: CASE_A, listDate: "2026-07-11" }, h)).toBe("final_hearing");
    expect(pickItemPurpose({ caseId: CASE_A, listDate: "2026-07-10" }, h)).toBeNull();
  });
  it("is null for other cases, no purpose, or no scheduled date", () => {
    const d = new Date("2026-07-11T05:00:00Z");
    const it = { caseId: CASE_A, listDate: "2026-07-11" };
    expect(pickItemPurpose(it, [{ caseId: CASE_B, scheduledDate: d, purpose: "x" }])).toBeNull();
    expect(pickItemPurpose(it, [{ caseId: CASE_A, scheduledDate: d, purpose: null }])).toBeNull();
    expect(pickItemPurpose(it, [{ caseId: CASE_A, scheduledDate: null, purpose: "x" }])).toBeNull();
  });
  it("first (newest) matching hearing with a purpose wins", () => {
    const d = new Date("2026-07-11T05:00:00Z");
    const h = [
      { caseId: CASE_A, scheduledDate: d, purpose: null },
      { caseId: CASE_A, scheduledDate: d, purpose: "arguments" },
      { caseId: CASE_A, scheduledDate: d, purpose: "older" },
    ];
    expect(pickItemPurpose({ caseId: CASE_A, listDate: "2026-07-11" }, h)).toBe("arguments");
  });
});

describe("listItemsWithPurpose", () => {
  beforeEach(() => { selects.length = 0; selectCalls = 0; });

  it("returns purpose per item, null when absent, keeping existing fields", async () => {
    selects.push(
      [item("i1", CASE_A, 1), item("i2", CASE_B, 2)],
      [{ caseId: CASE_A, scheduledDate: new Date("2026-07-11T05:00:00Z"), purpose: "final_hearing", updatedAt: new Date() }],
    );
    const out = await listItemsWithPurpose(TENANT, LIST);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: "i1", caseId: CASE_A, slot: "AM-1", courtroom: "A", version: 1, purpose: "final_hearing" });
    expect(out[1]).toMatchObject({ id: "i2", caseId: CASE_B, purpose: null });
  });

  it("empty list short-circuits without a hearings read", async () => {
    selects.push([]);
    expect(await listItemsWithPurpose(TENANT, LIST)).toEqual([]);
    expect(selectCalls).toBe(1);
  });
});
