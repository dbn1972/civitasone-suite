import { describe, it, expect, vi } from "vitest";

const captured: Record<string, (p: unknown) => unknown> = {};
const urls: string[] = [];
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (url: string, fallback: unknown, opts: { telemetryKey: string; mapResponse: (p: unknown) => unknown }) => {
    urls.push(url);
    captured[opts.telemetryKey] = opts.mapResponse;
    return Promise.resolve({ data: fallback, source: "api" });
  },
}));

import { getTendersPage, parsePageParam, TENDER_PAGE_SIZE } from "./loaders";

// GAP-WORKS-TENDERS-DETAIL-03 acceptance: the list can page past 100 and shows the real total.
describe("tenders register paging", () => {
  it("requests the server page and carries meta.total (not rows.length)", async () => {
    await getTendersPage(3);
    expect(urls).toContain(`/api/v1/works/tenders?page=3&pageSize=${TENDER_PAGE_SIZE}`);
    const out = captured["works.tenders.page"]({ data: [{ id: "t250" }], meta: { page: 3, pageSize: 50, total: 250 } }) as {
      rows: unknown[];
      total: number;
      page: number;
    };
    expect(out.total).toBe(250);
    expect(out.rows).toHaveLength(1);
    expect(out.page).toBe(3);
  });

  it("falls back to rows.length when meta.total is absent or invalid", async () => {
    await getTendersPage(1);
    const out = captured["works.tenders.page"]({ data: [{ id: "a" }, { id: "b" }], meta: { total: "x" } }) as { total: number };
    expect(out.total).toBe(2);
  });

  it("clamps an untrusted ?page= to a positive integer", () => {
    expect(parsePageParam(undefined)).toBe(1);
    expect(parsePageParam("0")).toBe(1);
    expect(parsePageParam("-4")).toBe(1);
    expect(parsePageParam("abc")).toBe(1);
    expect(parsePageParam("6")).toBe(6);
    expect(parsePageParam(["7", "9"])).toBe(7);
  });
});
