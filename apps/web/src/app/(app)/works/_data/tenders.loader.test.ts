import { describe, it, expect, vi } from "vitest";

// Mirror loaders.test.ts: stub fetchJson to capture each loader's mapResponse,
// then run it against a realistic works-service tenders payload.
const captured: Record<string, (p: unknown) => unknown> = {};
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (_url: string, fallback: unknown, opts: { telemetryKey: string; mapResponse: (p: unknown) => unknown }) => {
    captured[opts.telemetryKey] = opts.mapResponse;
    return Promise.resolve({ data: fallback, source: "api" });
  },
}));

import { getTenders, resolveTenderNames, type TenderRow } from "./loaders";

async function mapTenders(payload: unknown): Promise<TenderRow[]> {
  await getTenders();
  return captured["works.tenders"](payload) as TenderRow[];
}

describe("tenders loader mapping (GAP-WORKS-TENDERS-01/02, NEW-02)", () => {
  it("shows '—' (not a fabricated ₹0.00) when the tender amount is missing", async () => {
    const rows = await mapTenders({ data: [{ id: "t1", workId: "w", openingDate: null }] });
    // Empty amount — DataTable's formatMoney renders this as "—", never ₹0.00.
    expect(rows[0].amount).toBe("");
  });

  it("keeps a real amount as a paise string for formatMoney", async () => {
    const rows = await mapTenders({ data: [{ id: "t1", tenderAmountMinor: "15000000" }] });
    expect(rows[0].amount).toBe("15000000");
  });

  it("shows '—' for type/authority ids (no 8-char UUID prefixes) until resolved", async () => {
    const rows = await mapTenders({
      data: [{ id: "t1", tenderTypeId: "3f9a1c20-aaaa-bbbb-cccc-dddddddddddd", approvingAuthorityId: "aaaaaaaa-1111-2222-3333-444444444444" }],
    });
    expect(rows[0].tenderType).toBe("—");
    expect(rows[0].authority).toBe("—");
    expect(String(rows[0].tenderType)).not.toContain("…");
  });

  it("derives an honest schedule status, never 'open'/'closed' from a date", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const [upcoming] = await mapTenders({ data: [{ id: "t1", openingDate: future }] });
    const [passed] = await mapTenders({ data: [{ id: "t2", openingDate: past }] });
    expect(upcoming.status).toBe("Upcoming");
    expect(upcoming.statusKey).toBe("upcoming");
    expect(passed.status).toBe("Opening date passed");
    expect(passed.statusKey).toBe("opening_passed");
    // The old fabricated vocabulary must be gone.
    expect(upcoming.status).not.toBe("open");
    expect(passed.status).not.toBe("closed");
  });

  it("carries the raw ISO opening date for client-side range filtering", async () => {
    const iso = "2026-10-20T04:30:00.000Z";
    const [row] = await mapTenders({ data: [{ id: "t1", openingDate: iso }] });
    expect(row.openingDateIso).toBe(iso);
  });
});

describe("resolveTenderNames (GAP-WORKS-TENDERS-02 / NEW-03)", () => {
  it("resolves type and authority ids to master names, leaving '—' when unmapped", async () => {
    const rows = await mapTenders({
      data: [
        { id: "t1", tenderTypeId: "type-1", approvingAuthorityId: "auth-1" },
        { id: "t2", tenderTypeId: "type-unknown", approvingAuthorityId: null },
      ],
    });
    const resolved = resolveTenderNames(
      rows,
      { "type-1": "Open Tender" },
      { "auth-1": "Executive Engineer" },
    );
    expect(resolved[0].tenderType).toBe("Open Tender");
    expect(resolved[0].authority).toBe("Executive Engineer");
    // Unmapped id keeps the honest "—", never a UUID.
    expect(resolved[1].tenderType).toBe("—");
    expect(resolved[1].authority).toBe("—");
  });
});
