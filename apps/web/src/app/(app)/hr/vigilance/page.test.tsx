import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// Same mocking convention as hr/disciplinary/page.test.tsx: control the
// session role directly at the roleGuard module boundary rather than
// re-deriving it from a fake JWT cookie.
let mockRoles: string[] = ["hr_admin"];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

// DataTable (row links) uses the router; the charge-summary reveal control (MaskedReveal,
// GAP-HR-VIGILANCE-01) is a client component that needs the message catalogue.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import VigilancePage from "./page";

function rowFor(status: string, i: number) {
  return {
    id: `case-${i}`,
    caseNo: `VC/${i}`,
    employee: `Employee ${i}`,
    department: "Revenue",
    charges_summary: "Misconduct",
    filedDate: "2026-01-01",
    inquiryOfficer: "—",
    nextHearing: "—",
    inquiryAppointedDate: "—",
    status,
  };
}

// GAP-HR-VIGILANCE-04: the backend response now carries pagination/stat
// metadata (services/hrms-service/.../gap-features/routes.ts's GET
// /v1/hrms/vigilance) alongside the row array. This mock replaces fetchJson
// entirely (its mapResponse callback never runs), so the shape here must
// match what page.tsx's getData() now produces: { data: {items, total,
// hasMore, stats}, source }.
function apiResult(
  items: Record<string, unknown>[],
  stats: { chargeMemoStage: number; underInquiry: number; penaltyAndAppeal?: number; closed: number; dropped?: number; total: number },
) {
  return {
    data: { items, total: items.length, hasMore: false, stats },
    source: "api" as const,
  };
}

describe("VigilancePage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    mockRoles = ["hr_admin"];
  });

  it("links each case row to the shared disciplinary detail page using the real case number, not a fabricated reference", async () => {
    // Regression: this table used to have no rowLinkKey/rowLinkPrefix at
    // all (a vigilance case IS a disciplinary case, proceeding_type='major',
    // and had no way to reach its own already-built detail page from here),
    // and separately fabricated "VIG/"+id.slice(0,8) instead of using the
    // real, stored case_no the backend now returns (GAP-HR-VIGILANCE-06).
    fetchJsonMock.mockResolvedValue(apiResult(
      [rowFor("opened", 1)],
      { chargeMemoStage: 1, underInquiry: 0, closed: 0, total: 1 },
    ));

    const ui = await VigilancePage({});
    render(ui);

    const link = screen.getByRole("link", { name: "Open VC/1" });
    // GAP-HR-VIGILANCE-05: rows open the shared detail page with ?from=vigilance so its Back link returns here.
    expect(link).toHaveAttribute("href", "/hr/disciplinary/case-1?from=vigilance");
  });

  it("renders every stat-card bucket exactly as the backend computed it (GAP-HR-VIGILANCE-02)", async () => {
    // Stats deliberately disagree with a naive recount of the (short)
    // `items` array so a regression to client-side computation is caught.
    // penaltyAndAppeal is its own card: a penalty_imposed/appeal_filed case
    // must NOT show up under "Under Inquiry".
    fetchJsonMock.mockResolvedValue(apiResult(
      [rowFor("penalty_imposed", 1)],
      { chargeMemoStage: 4, underInquiry: 3, penaltyAndAppeal: 5, closed: 2, dropped: 1, total: 15 },
    ));

    const ui = await VigilancePage({});
    render(ui);

    // Scoped to the stat cards' own labels: the status filter's <option>s also read "Closed" etc.
    const val = (label: string) =>
      Array.from(document.querySelectorAll(".stat .lab")).find((el) => el.textContent === label)!.closest(".stat")!.querySelector(".val")?.textContent;
    expect(val("Charge Memo Stage")).toBe("4");
    expect(val("Under Inquiry")).toBe("3");
    expect(val("Penalty & Appeal")).toBe("5");
    expect(val("Closed")).toBe("2");
    expect(val("Dropped")).toBe("1");
    expect(val("Total Cases")).toBe("15");
    expect(["Charge Memo Stage", "Under Inquiry", "Penalty & Appeal", "Closed", "Dropped"].reduce((n, l) => n + Number(val(l)), 0)).toBe(15);
  });

  it("shows a link back to the full disciplinary register (GAP-HR-VIGILANCE-05)", async () => {
    fetchJsonMock.mockResolvedValue(apiResult(
      [],
      { chargeMemoStage: 0, underInquiry: 0, closed: 0, total: 0 },
    ));
    const ui = await VigilancePage({});
    render(ui);
    const link = screen.getByRole("link", { name: "All Disciplinary Cases" });
    expect(link).toHaveAttribute("href", "/hr/disciplinary");
  });

  it("shows an honest permission-denied state for a role the backend would reject", async () => {
    mockRoles = ["employee"];
    const ui = await VigilancePage({});
    render(ui);
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  // ── GAP-HR-VIGILANCE-01: charge text is masked until revealed ──────────────
  it("never puts the charge text on the page: the column is a masked control with a Reveal button", async () => {
    // Even if a backend that predates maskCharges sent the text, it is not forwarded to the table.
    fetchJsonMock.mockResolvedValue(apiResult(
      [{ ...rowFor("opened", 1), charges_summary: "Misconduct: took a bribe" }],
      { chargeMemoStage: 1, underInquiry: 0, closed: 0, total: 1 },
    ));
    const ui = await VigilancePage({});
    const { container } = render(ui);
    expect(container.textContent).not.toContain("Misconduct");
    expect(container.textContent).not.toContain("bribe");
    expect(screen.getByRole("button", { name: "Reveal" })).toBeInTheDocument();
    const [url] = fetchJsonMock.mock.calls[0] as [string];
    expect(new URL(url, "http://x").searchParams.get("maskCharges")).toBe("true");
  });

  it("a case with no charge text has nothing to reveal", async () => {
    fetchJsonMock.mockResolvedValue(apiResult(
      [{ ...rowFor("opened", 1), charges_summary: null, hasCharges: false }],
      { chargeMemoStage: 1, underInquiry: 0, closed: 0, total: 1 },
    ));
    const ui = await VigilancePage({});
    render(ui);
    expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
  });

  // ── GAP-HR-VIGILANCE-04: filters run on the backend ────────────────────────
  it("forwards a known status and a trimmed search to the backend; ignores an unknown status", async () => {
    fetchJsonMock.mockResolvedValue(apiResult([rowFor("closed", 1)], { chargeMemoStage: 0, underInquiry: 0, closed: 1, total: 1 }));
    await VigilancePage({ searchParams: { status: "closed", q: "  Menon  " } });
    const sp = new URL((fetchJsonMock.mock.calls[0] as [string])[0], "http://x").searchParams;
    expect(sp.get("status")).toBe("closed");
    expect(sp.get("q")).toBe("Menon");
    fetchJsonMock.mockClear();
    await VigilancePage({ searchParams: { status: "dropped" } });
    expect(new URL((fetchJsonMock.mock.calls[0] as [string])[0], "http://x").searchParams.has("status")).toBe(false);
  });

  it("renders a server-side filter form (status without 'dropped', search), pre-filled and clearable", async () => {
    fetchJsonMock.mockResolvedValue({ data: { items: [rowFor("closed", 1)], total: 1, hasMore: false, stats: { chargeMemoStage: 0, underInquiry: 0, penaltyAndAppeal: 0, closed: 1, dropped: 0, total: 1 } }, source: "api" as const });
    const ui = await VigilancePage({ searchParams: { status: "closed", q: "Menon" } });
    render(ui);
    const form = screen.getByRole("search", { name: "Filter vigilance cases" });
    const select = within(form).getByLabelText("Status") as HTMLSelectElement;
    expect(select.value).toBe("closed");
    expect(within(select).queryByRole("option", { name: /dropped/i })).not.toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Charge Memo Issued" })).toBeInTheDocument();
    expect((within(form).getByLabelText("Search") as HTMLInputElement).value).toBe("Menon");
    expect(within(form).getByRole("link", { name: "Clear" })).toHaveAttribute("href", "/hr/vigilance");
    expect(screen.getByText("1 matching cases")).toBeInTheDocument();
    // The table's own text box is gone: it could only search the loaded batch.
    expect(screen.queryByPlaceholderText(/Filter by/i)).not.toBeInTheDocument();
  });

  it("an unfiltered view shows no Clear link and no match count", async () => {
    fetchJsonMock.mockResolvedValue(apiResult([rowFor("opened", 1)], { chargeMemoStage: 1, underInquiry: 0, closed: 0, total: 1 }));
    render(await VigilancePage({}));
    expect(screen.queryByRole("link", { name: "Clear" })).not.toBeInTheDocument();
    expect(screen.queryByText(/matching cases/)).not.toBeInTheDocument();
  });

  it("shows a 'no match' message (not the empty-register one) when a filter finds nothing", async () => {
    fetchJsonMock.mockResolvedValue(apiResult([], { chargeMemoStage: 3, underInquiry: 0, closed: 0, total: 3 }));
    render(await VigilancePage({ searchParams: { q: "nobody" } }));
    expect(screen.getByText("No cases match")).toBeInTheDocument();
    expect(screen.queryByText("No vigilance cases on record")).not.toBeInTheDocument();
  });

  it("batch paging keeps the active filter in the Next/Previous links", async () => {
    fetchJsonMock.mockResolvedValue({ data: { items: [rowFor("closed", 1)], total: 450, hasMore: true, stats: { chargeMemoStage: 0, underInquiry: 0, penaltyAndAppeal: 0, closed: 450, dropped: 0, total: 450 } }, source: "api" as const });
    render(await VigilancePage({ searchParams: { page: "2", status: "closed", q: "Menon" } }));
    expect(new URL((fetchJsonMock.mock.calls[0] as [string])[0], "http://x").searchParams.get("offset")).toBe("200");
    const next = new URL(screen.getByRole("link", { name: /Next 200/ }).getAttribute("href")!, "http://x").searchParams;
    expect([next.get("page"), next.get("status"), next.get("q")]).toEqual(["3", "closed", "Menon"]);
    const prev = new URL(screen.getByRole("link", { name: /Previous 200/ }).getAttribute("href")!, "http://x").searchParams;
    expect([prev.get("page"), prev.get("status"), prev.get("q")]).toEqual(["1", "closed", "Menon"]);
  });
});
