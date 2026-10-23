import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => ["finance_officer"], getSessionUserId: () => null }));
const ucsMock = vi.fn();
const schemesMock = vi.fn();
vi.mock("../../../../_data/loaders", () => ({ getFinanceUCs: () => ucsMock(), getFinanceSchemes: () => schemesMock() }));
// The table is covered by UCsTable*.test.tsx; here only what the page hands it matters.
vi.mock("./UCsTable", () => ({
  UCsTable: (props: { scheme?: unknown }) => <div data-testid="uc-table" data-scheme={JSON.stringify(props.scheme ?? null)} />,
}));

import UCsPage from "./page";

const uc = (id: string, over: Record<string, unknown>) => ({
  id, ucNo: id, grantee: "Dept", amount: "1000", periodFrom: "2026-04-01", periodTo: "2026-06-30", status: "submitted", ...over,
});
const UCS = [
  uc("UC-A", { schemeCode: "PMAY", grantRef: "SAN/2026/77" }),
  uc("UC-B", { schemeCode: "MGN", grantRef: "Housing Scheme" }),
  uc("UC-C", { grantRef: "Housing Scheme" }),
  uc("UC-D", { grantRef: "Unrelated" }),
];
const SCHEMES = [{ code: "PMAY", name: "Housing Scheme" }, { code: "MGN", name: "Rural Jobs" }];

// GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-DETAIL-05: ?scheme= carries a Scheme Tracking code.
describe("UCsPage ?scheme= (scheme code filter)", () => {
  beforeEach(() => {
    ucsMock.mockReset();
    schemesMock.mockReset();
    ucsMock.mockResolvedValue({ data: UCS, source: "api" });
    schemesMock.mockResolvedValue({ data: SCHEMES, source: "api" });
  });

  it("without ?scheme= lists every certificate and does not read the schemes", async () => {
    render(await UCsPage({}));
    expect(schemesMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("uc-table")).toHaveAttribute("data-scheme", "null");
    expect(screen.queryByText(/Showing utilization certificates for the scheme/)).not.toBeInTheDocument();
    expect(within(screen.getByText("Total UCs").closest(".stat") as HTMLElement).getByText("4")).toBeInTheDocument();
  });

  it("resolves the code to the scheme, names it in the note, and counts only that scheme's certificates", async () => {
    render(await UCsPage({ searchParams: { scheme: "pmay" } }));
    expect(screen.getByTestId("uc-table")).toHaveAttribute("data-scheme", JSON.stringify({ code: "PMAY", name: "Housing Scheme" }));
    expect(screen.getByText(/Showing utilization certificates for the scheme "Housing Scheme"/)).toBeInTheDocument();
    // UC-A (stored code PMAY) and UC-C (older, matched by name) -- not UC-B (recorded against MGN) or UC-D.
    expect(within(screen.getByText("Total UCs").closest(".stat") as HTMLElement).getByText("2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show all" })).toHaveAttribute("href", "/finance/expenditure/utilization-certificates");
  });

  it("still filters (by the value as given) when the schemes could not be loaded", async () => {
    schemesMock.mockResolvedValue({ data: [], source: "error", status: 500 });
    render(await UCsPage({ searchParams: { scheme: "Unrelated" } }));
    expect(screen.getByTestId("uc-table")).toHaveAttribute("data-scheme", JSON.stringify({ code: "Unrelated", name: "Unrelated" }));
    expect(within(screen.getByText("Total UCs").closest(".stat") as HTMLElement).getByText("1")).toBeInTheDocument();
  });
});
