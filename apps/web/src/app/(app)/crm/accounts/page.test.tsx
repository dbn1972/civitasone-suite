import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../_data/loaders", () => ({ getCrmAccounts: vi.fn() }));
vi.mock("./AccountsTable", () => ({ AccountsTable: () => <div data-testid="accounts-table" /> }));
vi.mock("./AccountHierarchy", () => ({ AccountHierarchy: () => <div data-testid="hierarchy" /> }));
vi.mock("./NewAccountForm", () => ({ NewAccountForm: () => <div data-testid="new-form" /> }));
vi.mock("../../../_components/crm/MergeButton", () => ({ MergeButton: () => <div data-testid="merge" /> }));
vi.mock("./hierarchy", () => ({
  countSubsidiaries: vi.fn((accs: { parentId?: string }[]) => accs.filter((a) => a.parentId).length),
  buildAccountTree: vi.fn(() => []),
}));

import Page from "./page";
import { getCrmAccounts } from "../../../_data/loaders";

const mocked = vi.mocked(getCrmAccounts);

const sampleAccounts = [
  { id: "1", name: "NDMA", industry: "Disaster Management", website: "ndma.gov.in", contactCount: 5, parentId: undefined },
  { id: "2", name: "SDMA UP", industry: "Disaster Management", website: "sdma.up.gov.in", contactCount: 3, parentId: "1" },
];

beforeEach(() => mocked.mockReset());

describe("Accounts list page", () => {
  it("renders heading 'Accounts'", async () => {
    mocked.mockResolvedValue({ data: [], source: "api" });
    render(await Page());
    expect(screen.getByRole("heading", { name: "Accounts" })).toBeInTheDocument();
  });

  // GAP-CRM-ACCOUNTS-07: the subtitle comes from the crm.accounts.subtitle
  // next-intl key; the English string carries no hard-coded Devanagari suffix.
  it("renders the subtitle from i18n with no Devanagari characters (en)", async () => {
    mocked.mockResolvedValue({ data: [], source: "api" });
    render(await Page());
    const subtitle = screen.getByText(/Organisation master/);
    expect(subtitle).toBeInTheDocument();
    expect(/[\u0900-\u097F]/.test(subtitle.textContent ?? "")).toBe(false);
  });

  it("renders 'Sectors / Ministries' label (not 'Industries Covered')", async () => {
    mocked.mockResolvedValue({ data: [], source: "api" });
    render(await Page());
    expect(screen.getByText("Sectors / Ministries")).toBeInTheDocument();
    expect(screen.queryByText("Industries Covered")).not.toBeInTheDocument();
  });

  it("renders AccountsTable and AccountHierarchy", async () => {
    mocked.mockResolvedValue({ data: [], source: "api" });
    render(await Page());
    expect(screen.getByTestId("accounts-table")).toBeInTheDocument();
    expect(screen.getByTestId("hierarchy")).toBeInTheDocument();
  });

  it("shows real counts when load succeeds", async () => {
    mocked.mockResolvedValue({ data: sampleAccounts as never, source: "api" });
    render(await Page());
    // Linked Contacts = 5+3 = 8, unique among stat values
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.queryByText(/couldn.t load/i)).not.toBeInTheDocument();
  });

  // UX-012: the "couldn't load" badge assertion that used to live here was
  // removed — AccountsTable is mocked out in this file, and the badge now
  // lives inside the real AccountsTable (reading the same useSeededResource
  // call as its rows, so it can never disagree with what the table shows;
  // UX-002's pattern). No coverage lost: the stat-fallback behavior below
  // (the `stat()` "—" gating, a separate and unrelated concern) is still
  // covered here, and AccountsTable's own provenance-driven badge is a
  // shared-component concern already covered by DataSourceBadge.test.tsx.
  it("shows '—' for all stats when load fails (source='error')", async () => {
    mocked.mockResolvedValue({ data: [], source: "error" });
    render(await Page());
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });

  // GAP-CRM-ACCOUNTS-02: a full page means the endpoint capped the list and the
  // counts are of the loaded page only — say so instead of presenting a page
  // count as the whole-master total.
  it("shows a 'Showing the first N accounts' hint and partial stat labels when truncated", async () => {
    mocked.mockResolvedValue({
      data: sampleAccounts as never,
      source: "api",
      truncated: true,
      pageLimit: 200,
    } as never);
    render(await Page());
    expect(screen.getByText(/Showing the first 200 accounts/i)).toBeInTheDocument();
    expect(screen.getByText("Total Accounts (in loaded accounts)")).toBeInTheDocument();
  });

  it("does not show the truncation hint when the page is not full", async () => {
    mocked.mockResolvedValue({
      data: sampleAccounts as never,
      source: "api",
      truncated: false,
      pageLimit: 200,
    } as never);
    render(await Page());
    expect(screen.queryByText(/Showing the first/i)).not.toBeInTheDocument();
    expect(screen.getByText("Total Accounts")).toBeInTheDocument();
  });

  // GAP-CRM-ACCOUNTS-02 (wave2): with a real server total greater than the loaded
  // page, the page shows an exact "Showing N of M accounts" and the Total Accounts
  // tile reports M, not the page count.
  it("shows 'Showing N of M accounts' and the real total when the backend returns meta.total", async () => {
    mocked.mockResolvedValue({
      data: sampleAccounts as never,
      source: "api",
      truncated: true,
      pageLimit: 200,
      total: 120,
    } as never);
    render(await Page());
    expect(screen.getByText(/Showing 2 of 120 accounts/i)).toBeInTheDocument();
    // Total Accounts tile shows the authoritative total.
    expect(screen.getByText("120")).toBeInTheDocument();
  });
});
