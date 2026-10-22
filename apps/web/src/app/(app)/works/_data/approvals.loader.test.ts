import { describe, it, expect, vi, beforeEach } from "vitest";

// GAP-WORKS-APPROVALS-01: the approvals API joins the work number itself, but the officer NAME lives in identity-service.
// fetchJson is stubbed per URL and each loader's own mapResponse is run against a realistic payload. The officer lookup
// must hit the tenant user directory (the non-PII, tenant-wide endpoint), NOT the admin-gated /identity/users list.
const W1 = "11111111-1111-4111-8111-111111111111";
const W2 = "22222222-2222-4222-8222-222222222222";
const U1 = "33333333-3333-4333-8333-333333333333";
const U2 = "44444444-4444-4444-8444-444444444444";

const AA_URL = "/api/v1/works/approvals/aa?pageSize=100";
const TS_URL = "/api/v1/works/approvals/ts?pageSize=100";
let payloads: Record<string, unknown> = {};
const fetchedUrls: string[] = [];

vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (url: string, fallback: unknown, opts: { mapResponse: (p: unknown) => unknown; telemetryKey: string }) => {
    fetchedUrls.push(url);
    const key = url.includes("/works/proposals?ids=") ? "workNumbers" : url.includes("/identity/users/directory") ? "officers" : url;
    const payload = payloads[key];
    return Promise.resolve(payload === undefined ? { data: fallback, source: "error", status: 500 } : { data: opts.mapResponse(payload), source: "api" });
  },
}));

import { getApprovalsAa, getApprovalsTs } from "./loaders";
import { formatIndianDate } from "@/lib/formatters";

beforeEach(() => {
  fetchedUrls.length = 0;
  payloads = {
    [AA_URL]: {
      data: [
        { id: "a1", workId: W1, aaNumber: "AA/1", aaDate: "2026-07-12", approvingAuthorityId: U1, approvedAmountMinor: "100", approvalType: "original", status: "draft" },
        { id: "a2", workId: W2, aaNumber: "AA/2", aaDate: "2026-07-13", approvingAuthorityId: U2, approvedAmountMinor: "200", approvalType: "revised", status: "finalized" },
      ],
    },
    workNumbers: { data: [{ id: W1, workNumber: "WK-2026-0042" }] },
    officers: { data: [{ id: U1, displayName: "Anita Rao" }] },
  };
});

describe("approvals loader name resolution (GAP-WORKS-APPROVALS-01)", () => {
  it("shows the real work number and officer name, and flags a row as unresolved only where a lookup has no match", async () => {
    const res = await getApprovalsAa();
    expect(res.data[0]!.workNumber).toBe("WK-2026-0042");
    expect(res.data[0]!.workNumberResolved).toBe(true);
    expect(res.data[0]!.authority).toBe("Anita Rao");
    expect(res.data[0]!.authorityResolved).toBe(true);
    // second row has no match in either lookup -> short id fallback, FLAGGED so the table labels it as an ID, never a blank or an error
    expect(res.data[1]!.workNumber).toMatch(/^22222222/);
    expect(res.data[1]!.workNumberResolved).toBe(false);
    expect(res.data[1]!.workId).toBe(W2);
    expect(res.data[1]!.authority).toMatch(/^44444444/);
    expect(res.data[1]!.authorityResolved).toBe(false);
    expect(res.data[1]!.authorityId).toBe(U2);
    // one batched work lookup (ids=), not one request per row
    expect(fetchedUrls.filter((u) => u.includes("/works/proposals?ids=")).length).toBe(1);
  });

  it("looks officers up in the tenant user directory by id (batched), never in the admin-only /identity/users list", async () => {
    await getApprovalsAa();
    const officerUrls = fetchedUrls.filter((u) => u.includes("/identity/"));
    expect(officerUrls).toHaveLength(1);
    expect(officerUrls[0]).toBe(`/v1/identity/users/directory?ids=${U1},${U2}`);
    expect(fetchedUrls.some((u) => /\/identity\/users\?/.test(u))).toBe(false);
    expect(fetchedUrls.some((u) => u.includes("limit=200"))).toBe(false);
  });

  it("is not capped at 200 officers: ids beyond 200 go out in further batches", async () => {
    const many = Array.from({ length: 450 }, (_v, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    payloads[AA_URL] = {
      data: many.map((id, i) => ({ id: `a${i}`, workId: W1, aaNumber: `AA/${i}`, aaDate: "2026-07-12", approvingAuthorityId: id, approvedAmountMinor: "1", status: "draft" })),
    };
    await getApprovalsAa();
    const officerUrls = fetchedUrls.filter((u) => u.includes("/identity/users/directory"));
    expect(officerUrls).toHaveLength(3); // 200 + 200 + 50
  });

  it("uses the workNumber the API returns and skips the web-side work lookup for those rows", async () => {
    payloads[AA_URL] = {
      data: [{ id: "a1", workId: W1, workNumber: "WK/2026/001", aaNumber: "AA/1", aaDate: "2026-07-12", approvingAuthorityId: U1, approvedAmountMinor: "100", status: "draft" }],
    };
    const res = await getApprovalsAa();
    expect(res.data[0]!.workNumber).toBe("WK/2026/001");
    expect(res.data[0]!.workNumberResolved).toBe(true);
    expect(fetchedUrls.some((u) => u.includes("/works/proposals?ids="))).toBe(false);
    // the officer still comes from the directory
    expect(res.data[0]!.authority).toBe("Anita Rao");
  });

  it("the TS register resolves the same way, so the register and the detail page agree", async () => {
    payloads[TS_URL] = {
      data: [{ id: "t1", workId: W1, tsNumber: "TS/1", tsDate: "2026-07-12", tsAuthorityId: U1, tsAmountMinor: "100", sanctionType: "original", status: "draft" }],
    };
    const res = await getApprovalsTs();
    expect(res.data[0]).toMatchObject({ workNumber: "WK-2026-0042", workNumberResolved: true, authority: "Anita Rao", authorityResolved: true });
  });

  it("a failed directory lookup leaves the row flagged unresolved (no error, no blank)", async () => {
    delete payloads.officers;
    const res = await getApprovalsAa();
    expect(res.source).toBe("api");
    expect(res.data[0]!.authorityResolved).toBe(false);
    expect(res.data[0]!.authority).toMatch(/^33333333/);
  });

  it("a row with no work id or authority id is not flagged (there is nothing to resolve)", async () => {
    payloads[AA_URL] = { data: [{ id: "a9", workId: null, aaNumber: "AA/9", aaDate: "2026-07-12", approvingAuthorityId: null, approvedAmountMinor: "1", status: "draft" }] };
    const res = await getApprovalsAa();
    expect(res.data[0]).toMatchObject({ workNumberResolved: true, authorityResolved: true });
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
