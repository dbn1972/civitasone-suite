import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const getGrantApplicationsMock = vi.fn();
vi.mock("../_data", () => ({
  getGrantApplications: () => getGrantApplicationsMock(),
}));

import GrantApplicationsPage from "./page";

const APPS = [
  { id: "a1", grantNo: "G1", title: "Water supply", granteeName: "GP Alpha", totalAmount: 45000, disbursedAmount: 0, pendingAmount: 45000, sanctionDate: "2026-08-12", status: "submitted" },
  { id: "a2", grantNo: "G2", title: "Road repair", granteeName: "GP Beta", totalAmount: 90000, disbursedAmount: 0, pendingAmount: 90000, sanctionDate: "2026-08-12", status: "approved" },
];

describe("GrantApplicationsPage", () => {
  beforeEach(() => {
    getGrantApplicationsMock.mockReset();
    pushMock.mockReset();
    getGrantApplicationsMock.mockResolvedValue({ data: APPS, source: "api" });
  });

  it("renders exactly one breadcrumb back-link to /grants", async () => {
    render(await GrantApplicationsPage({ searchParams: {} }));
    const backLinks = screen.getAllByRole("link", { name: "Grants" });
    expect(backLinks).toHaveLength(1);
    expect(backLinks[0]).toHaveAttribute("href", "/grants");
  });

  it("renders the heading and both applications when unfiltered", async () => {
    render(await GrantApplicationsPage({ searchParams: {} }));
    expect(screen.getByRole("heading", { level: 1, name: "Grant Applications" })).toBeInTheDocument();
    expect(screen.getByText("Water supply")).toBeInTheDocument();
    expect(screen.getByText("Road repair")).toBeInTheDocument();
  });

  // GAP-GRANTS-APPLICATIONS-02: ?status=approved lists only approved rows.
  it("filters rows by a valid ?status= param", async () => {
    render(await GrantApplicationsPage({ searchParams: { status: "approved" } }));
    expect(screen.getByText("Road repair")).toBeInTheDocument();
    expect(screen.queryByText("Water supply")).not.toBeInTheDocument();
  });

  // GAP-GRANTS-APPLICATIONS-02: the bogus "pending" value is ignored (no filter).
  it("ignores an invalid status (e.g. legacy 'pending') and shows all rows", async () => {
    render(await GrantApplicationsPage({ searchParams: { status: "pending" } }));
    expect(screen.getByText("Water supply")).toBeInTheDocument();
    expect(screen.getByText("Road repair")).toBeInTheDocument();
  });

  // GAP-GRANTS-APPLICATIONS-05: the title column heading reads "Title".
  it("labels the title column 'Title', not 'Purpose / Title'", async () => {
    render(await GrantApplicationsPage({ searchParams: {} }));
    expect(screen.getByRole("columnheader", { name: "Title" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Purpose \/ Title/ })).not.toBeInTheDocument();
  });

  // GAP-GRANTS-APPLICATIONS-03: a failed fetch shows the retry state, not the
  // first-run "No grant applications yet" empty copy, and stat cards show "—".
  it("shows a retry state (not first-run empty) on a failed fetch", async () => {
    getGrantApplicationsMock.mockResolvedValue({ data: [], source: "error" });
    render(await GrantApplicationsPage({ searchParams: {} }));
    expect(screen.queryByText(/No grant applications yet/)).not.toBeInTheDocument();
    const total = screen.getByText("Total").closest(".stat")!;
    expect(within(total as HTMLElement).getByText("—")).toBeInTheDocument();
  });
});
