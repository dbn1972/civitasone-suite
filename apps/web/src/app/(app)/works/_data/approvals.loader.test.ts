import { describe, it, expect, vi } from "vitest";

// GAP-WORKS-APPROVALS-01: the approvals API returns only ids; the loaders resolve work numbers and officer names
// web-side. fetchJson is stubbed per URL and each loader's own mapResponse is run against a realistic payload.
const W1 = "11111111-1111-4111-8111-111111111111";
const W2 = "22222222-2222-4222-8222-222222222222";
const U1 = "33333333-3333-4333-8333-333333333333";

const payloads: Record<string, unknown> = {
  "/api/v1/works/approvals/aa?pageSize=100": {
    data: [
      { id: "a1", workId: W1, aaNumber: "AA/1", aaDate: "2026-07-12", approvingAuthorityId: U1, approvedAmountMinor: "100", approvalType: "original", status: "draft" },
      { id: "a2", workId: W2, aaNumber: "AA/2", aaDate: "2026-07-13", approvingAuthorityId: "44444444-4444-4444-8444-444444444444", approvedAmountMinor: "200", approvalType: "revised", status: "finalized" },
    ],
  },
  "workNumbers": { data: [{ id: W1, workNumber: "WK-2026-0042" }] },
  "officers": { data: [{ id: U1, name: "Anita Rao" }] },
};

const fetchedUrls: string[] = [];
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (url: string, fallback: unknown, opts: { mapResponse: (p: unknown) => unknown; telemetryKey: string }) => {
    fetchedUrls.push(url);
    const key = url.includes("/works/proposals?ids=") ? "workNumbers" : url.includes("/identity/users") ? "officers" : url;
    const payload = payloads[key];
    return Promise.resolve(payload === undefined ? { data: fallback, source: "error", status: 500 } : { data: opts.mapResponse(payload), source: "api" });
  },
}));

import { getApprovalsAa } from "./loaders";
import { formatIndianDate } from "@/lib/formatters";

describe("approvals loader name resolution (GAP-WORKS-APPROVALS-01)", () => {
  it("shows the real work number and officer name, and a short id only where a lookup has no match", async () => {
    const res = await getApprovalsAa();
    expect(res.data[0]!.workNumber).toBe("WK-2026-0042");
    expect(res.data[0]!.authority).toBe("Anita Rao");
    // second row has no match in either lookup -> short id fallback, never a blank or an error
    expect(res.data[1]!.workNumber).toMatch(/^22222222/);
    expect(res.data[1]!.authority).toMatch(/^44444444/);
    // one batched work lookup (ids=), not one request per row
    expect(fetchedUrls.filter((u) => u.includes("/works/proposals?ids=")).length).toBe(1);
  });
});

describe("approvals dates (GAP-WORKS-APPROVALS-AA-DETAIL-05 / TS-DETAIL-05)", () => {
  it("the register shows exactly the string the detail page shows (both use formatIndianDate, IST-correct)", async () => {
    const res = await getApprovalsAa();
    expect(res.data[0]!.date).toBe(formatIndianDate("2026-07-12"));
    // 2026-07-11T20:00:00Z is 01:30 on the 12th in IST
    expect(formatIndianDate("2026-07-11T20:00:00Z")).toBe(formatIndianDate("2026-07-12"));
  });
});
