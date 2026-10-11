/**
 * Workforce Core read model — unit tests for the typed wrappers in
 * read-model.ts (ST-M01-07). The DB is mocked at the scopedRead seam; the SQL
 * itself is proven against real Postgres in workforce-core-schema-real-db.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.fn();
const scopedRead = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ execute }));

vi.mock("../src/shared/db.js", () => ({
  scopedRead: (fn: (tx: unknown) => Promise<unknown>) => scopedRead(fn),
}));

import {
  serviceTenureDays,
  currentStationTenureDays,
  currentPosting,
} from "../src/modules/workforce-core/read-model.js";

const EMP = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  execute.mockReset();
  scopedRead.mockClear();
});

describe("serviceTenureDays", () => {
  it("returns the numeric days and reads inside the tenant transaction", async () => {
    execute.mockResolvedValueOnce([{ days: 32 }]);
    expect(await serviceTenureDays(EMP, "2020-02-01")).toBe(32);
    expect(scopedRead).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("coerces string results (bigint-ish drivers) to a number", async () => {
    execute.mockResolvedValueOnce([{ days: "15" }]);
    expect(await serviceTenureDays(EMP, "2020-02-01")).toBe(15);
  });

  it("returns 0 when no row / null", async () => {
    execute.mockResolvedValueOnce([]);
    expect(await serviceTenureDays(EMP, "2020-02-01")).toBe(0);
    execute.mockResolvedValueOnce([{ days: null }]);
    expect(await serviceTenureDays(EMP, "2020-02-01")).toBe(0);
  });
});

describe("currentStationTenureDays", () => {
  it("returns the numeric days", async () => {
    execute.mockResolvedValueOnce([{ days: 367 }]);
    expect(await currentStationTenureDays(EMP, "2021-01-01")).toBe(367);
    expect(scopedRead).toHaveBeenCalledTimes(1);
  });

  it("returns 0 when there is no current substantive posting", async () => {
    execute.mockResolvedValueOnce([]);
    expect(await currentStationTenureDays(EMP, "2021-01-01")).toBe(0);
  });
});

describe("currentPosting", () => {
  it("maps a view row to the typed shape", async () => {
    execute.mockResolvedValueOnce([
      {
        employee_id: EMP,
        office_id: "o-1",
        post_id: "p-1",
        effective_from: "2020-01-01",
        effective_to: "2022-12-31",
        order_ref: "ORD/1",
        station_tenure_days: "100",
      },
    ]);
    expect(await currentPosting(EMP)).toEqual({
      employeeId: EMP,
      officeId: "o-1",
      postId: "p-1",
      effectiveFrom: "2020-01-01",
      effectiveTo: "2022-12-31",
      orderRef: "ORD/1",
      stationTenureDays: 100,
    });
  });

  it("maps nulls (open span, no post, no order) to null", async () => {
    execute.mockResolvedValueOnce([
      {
        employee_id: EMP,
        office_id: "o-1",
        post_id: null,
        effective_from: "2020-01-01",
        effective_to: null,
        order_ref: null,
        station_tenure_days: null,
      },
    ]);
    const r = await currentPosting(EMP);
    expect(r).toMatchObject({ postId: null, effectiveTo: null, orderRef: null, stationTenureDays: 0 });
  });

  it("returns null when the employee has no posting", async () => {
    execute.mockResolvedValueOnce([]);
    expect(await currentPosting(EMP)).toBeNull();
  });
});
