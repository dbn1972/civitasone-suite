import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

let mockRoles: string[] = ["hr_admin"];
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => mockRoles }));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

// Capture exactly what the server page hands to the (client) DataTable -- that
// is what gets serialised into the RSC payload.
let tableProps: { rows: Array<Record<string, unknown>>; rowLinkKey?: string } | null = null;
vi.mock("../../../_components/ds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../_components/ds")>();
  return {
    ...actual,
    DataTable: (props: { rows: Array<Record<string, unknown>>; rowLinkKey?: string }) => {
      tableProps = props;
      return <div data-testid="table" />;
    },
  };
});

import IccPage from "./page";

function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const LEAK_IDS = {
  createdBy: "22222222-2222-4222-8222-222222222222",
  tenantId: "33333333-3333-4333-8333-333333333333",
  complainantId: "44444444-4444-4444-8444-444444444444",
  respondentId: "55555555-5555-4555-8555-555555555555",
};
const SECRET_SUMMARY = "Free-text summary that names the aggrieved woman";
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// A row exactly as a misbehaving / older backend could send it: every internal
// column present, the confidential flag false and the summary populated.
const RAW_ROW = {
  id: CASE_ID, caseNo: "ICC/2026/001", summary: SECRET_SUMMARY, filedAt: "2026-02-01T10:00:00.000Z",
  status: "filed", confidential: false, iccMembersOnly: false, version: 3, ...LEAK_IDS,
};
const STATS = { filed: 70, underInquiry: 20, disposed: 30 };

function respond(rows: unknown[], total = rows.length, stats: unknown = STATS) {
  fetchJsonMock.mockImplementation(async (_u: string, _e: unknown, o: { mapResponse: (p: unknown) => unknown }) => ({
    source: "api", data: o.mapResponse({ data: rows, total, ...(stats ? { stats } : {}) }),
  }));
}
const tile = (label: string) => {
  const lab = Array.from(document.querySelectorAll(".stat .lab")).find((el) => el.textContent === label);
  if (!lab) throw new Error(`no tile ${label}`);
  return lab.closest(".stat")!.querySelector(".val")!.textContent;
};

beforeEach(() => { fetchJsonMock.mockReset(); tableProps = null; mockRoles = ["hr_admin"]; });

describe("/hr/icc rows handed to the client table (GAP-HR-ICC-01)", () => {
  it("passes an explicit allow-list: no createdBy / tenantId / iccMembersOnly / version / identity ids, and no UUID but the case id", async () => {
    respond([RAW_ROW]);
    render(await IccPage({}));
    expect(tableProps).not.toBeNull();
    const row = tableProps!.rows[0]!;
    expect(Object.keys(row).sort()).toEqual(["caseNo", "confidential", "filedAt", "id", "status", "summary"]);
    for (const id of Object.values(LEAK_IDS)) expect(JSON.stringify(tableProps!.rows)).not.toContain(id);
    expect(JSON.stringify(tableProps!.rows).match(UUID_RE)).toEqual([CASE_ID]);
  });

  it("an hr_admin never sees the free-text summary -- even when the row says confidential=false and the API sent it", async () => {
    respond([RAW_ROW]);
    render(await IccPage({}));
    expect(JSON.stringify(tableProps!.rows)).not.toContain(SECRET_SUMMARY);
    expect(tableProps!.rows[0]!.summary).toBe("Confidential complaint — case ref: ICC/2026/001");
  });

  it("super_admin is treated the same", async () => {
    mockRoles = ["super_admin"];
    respond([RAW_ROW]);
    render(await IccPage({}));
    expect(JSON.stringify(tableProps!.rows)).not.toContain(SECRET_SUMMARY);
  });

  it("an icc_member sees the summary, still without any internal column", async () => {
    mockRoles = ["icc_member"];
    respond([RAW_ROW]);
    render(await IccPage({}));
    expect(tableProps!.rows[0]!.summary).toBe(SECRET_SUMMARY);
    expect(Object.keys(tableProps!.rows[0]!).sort()).toEqual(["caseNo", "confidential", "filedAt", "id", "status", "summary"]);
    expect(JSON.stringify(tableProps!.rows)).not.toContain(LEAK_IDS.createdBy);
    // Only an icc_member can open the identity-bearing detail page, so only they get row links.
    expect(tableProps!.rowLinkKey).toBe("id");
  });

  it("an hr_admin gets no row link to the icc_member-only detail page", async () => {
    respond([RAW_ROW]);
    render(await IccPage({}));
    expect(tableProps!.rowLinkKey).toBeUndefined();
  });

  it("a row with no confidential flag is treated as confidential (over-masking is the safe side)", async () => {
    const { confidential: _c, ...noFlag } = RAW_ROW;
    void _c;
    respond([noFlag]);
    render(await IccPage({}));
    expect(tableProps!.rows[0]!.confidential).toBe(true);
    expect(screen.getByRole("note")).toBeInTheDocument(); // the s.16 redaction notice
  });
});

describe("/hr/icc stat cards and paging (GAP-HR-ICC-05)", () => {
  it("stat cards are the backend's whole-register counts, not counts of the rows on this page", async () => {
    // One row on screen, but the register holds 120.
    mockRoles = ["icc_member"];
    respond([{ ...RAW_ROW, status: "filed" }], 120);
    render(await IccPage({}));
    expect(tile("Total Complaints")).toBe("120");
    expect(tile("Filed")).toBe("70");
    expect(tile("Under Inquiry")).toBe("20");
    expect(tile("Disposed")).toBe("30");
  });

  it("shows — (never a page-slice count) when the backend sends no stats", async () => {
    respond([{ ...RAW_ROW, status: "filed" }], 1, null);
    render(await IccPage({}));
    expect(tile("Total Complaints")).toBe("1");
    expect(tile("Filed")).toBe("—");
    expect(tile("Under Inquiry")).toBe("—");
    expect(tile("Disposed")).toBe("—");
  });

  it("120 complaints: page 2 asks for offset 100 and links back; page 1 links forward", async () => {
    respond([RAW_ROW], 120);
    render(await IccPage({ searchParams: { page: "2" } }));
    expect(fetchJsonMock.mock.calls[0]![0]).toContain("limit=100&offset=100");
    expect(screen.getByRole("link", { name: /Previous/ })).toHaveAttribute("href", "/hr/icc?page=1");
    expect(screen.queryByRole("link", { name: /Next/ })).not.toBeInTheDocument();

    fetchJsonMock.mockClear();
    respond([RAW_ROW], 120);
    document.body.innerHTML = "";
    render(await IccPage({}));
    expect(fetchJsonMock.mock.calls[0]![0]).toContain("limit=100&offset=0");
    expect(screen.getByRole("link", { name: /Next/ })).toHaveAttribute("href", "/hr/icc?page=2");
  });

  it("denies a role outside the ICC gate without fetching", async () => {
    mockRoles = ["employee"];
    render(await IccPage({}));
    expect(fetchJsonMock).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
  });
});
