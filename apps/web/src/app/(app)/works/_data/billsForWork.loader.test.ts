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

import { getBillsForWork } from "./loaders";

// GAP-WORKS-BILLING-WORKID-01 acceptance: the API row (billNumber/billMode/status)
// maps to billNo/mode and keeps the raw workflow code for BillingActions.
describe("getBillsForWork mapper (GAP-WORKS-BILLING-WORKID-01)", () => {
  it("maps billNumber RA-01 / e_mb / so_finalized to billNo, mode and rawStatus", async () => {
    await getBillsForWork("w-1");
    expect(urls).toContain("/api/v1/works/billing/w-1/bills");
    const rows = captured["works.billing.detail"]({
      data: [
        {
          id: "b1",
          workId: "w-1",
          billNumber: "RA-01",
          billMode: "e_mb",
          status: "so_finalized",
          grossAmountMinor: "100000",
          netPayableMinor: "90000",
        },
      ],
    }) as Array<Record<string, unknown>>;
    expect(rows[0].billNo).toBe("RA-01");
    expect(rows[0].billNo).not.toBe("");
    expect(String(rows[0].mode)).not.toBe("");
    expect(String(rows[0].mode)).not.toBe("undefined");
    expect(rows[0].rawStatus).toBe("so_finalized");
    expect(rows[0].gross).toBe("100000");
  });
});
