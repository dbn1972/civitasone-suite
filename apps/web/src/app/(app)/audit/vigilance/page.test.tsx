import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

// GAP-AUDIT-VIGILANCE-02: control the caller's roles without touching
// next/headers. Default to a vigilance reader so the existing assertions see
// unmasked data; individual tests override sessionRoles for the masking case.
let sessionRoles: string[] = ["audit_officer"];
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return {
    ...actual,
    getSessionRoles: () => sessionRoles,
  };
});

import VigilancePage from "./page";

const MOCK_ROWS = [{ id: "v1", inquiryStatus: "under_investigation", outcome: null }];

describe("VigilancePage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    sessionRoles = ["audit_officer"];
  });

  it("renders vigilance cases and real stat counts on success", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_ROWS, source: "api" });
    render(await VigilancePage());
    expect(screen.getAllByText("Total Cases").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });

  it("shows the honest empty state when there genuinely are no vigilance cases", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await VigilancePage());
    expect(screen.getByText("No vigilance cases found")).toBeInTheDocument();
  });

  it("shows the error state — not zero stat cards or the empty-state prompt — on a real fetch failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    render(await VigilancePage());
    expect(screen.getByText("We couldn't load vigilance cases.")).toBeInTheDocument();
    expect(screen.queryByText("No vigilance cases found")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  // GAP-AUDIT-VIGILANCE-03: a charge_sheet_issued case used to fall into no
  // KPI bucket, so the stage cards could sum to less than Total Cases.
  it("surfaces charge_sheet_issued and reconciles stage buckets with Total Cases", async () => {
    const rows = [
      { id: "a", inquiryStatus: "preliminary_enquiry", outcome: "pending" },
      { id: "b", inquiryStatus: "under_investigation", outcome: "pending" },
      { id: "c", inquiryStatus: "charge_sheet_issued", outcome: "pending" },
      { id: "d", inquiryStatus: "inquiry_complete", outcome: "major_penalty" },
    ];
    fetchJsonMock.mockResolvedValue({ data: rows, source: "api" });
    render(await VigilancePage());

    // Total = 4; stage buckets: preliminary/under-investigation = 2,
    // charge sheet issued = 1, inquiry complete = 1 => sum reconciles to 4.
    // "Charge Sheet Issued" also appears as a table row status pill, so assert
    // on getAllByText (KPI card label + possible row pill).
    expect(screen.getAllByText("Charge Sheet Issued").length).toBeGreaterThan(0);
    expect(screen.getByText("Preliminary / Under Investigation")).toBeInTheDocument();
    const two = screen.getAllByText("2");
    expect(two.length).toBeGreaterThan(0);
  });

  // GAP-AUDIT-VIGILANCE-02 (DPDP): officer identity + charge text are masked
  // and the client CSV export is withheld for callers outside the vigilance
  // reader roles; a vigilance reader sees them in the clear.
  it("masks officer/charges and hides export for a non-vigilance role (e.g. finance_admin)", async () => {
    sessionRoles = ["finance_admin"];
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "v1", caseNo: "VC-1", officer: "Ramesh Kumar", charges: "Misappropriation of funds", inquiryStatus: "under_investigation", outcome: "pending" }],
      source: "api",
    });
    render(await VigilancePage());
    expect(screen.queryByText("Ramesh Kumar")).not.toBeInTheDocument();
    expect(screen.queryByText("Misappropriation of funds")).not.toBeInTheDocument();
    expect(screen.getByText("RK ••••")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /csv/i })).not.toBeInTheDocument();
  });

  it("shows officer/charges in the clear for a vigilance reader role", async () => {
    sessionRoles = ["vigilance_officer"];
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "v1", caseNo: "VC-1", officer: "Ramesh Kumar", charges: "Misappropriation of funds", inquiryStatus: "under_investigation", outcome: "pending" }],
      source: "api",
    });
    render(await VigilancePage());
    expect(screen.getByText("Ramesh Kumar")).toBeInTheDocument();
    expect(screen.getByText("Misappropriation of funds")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /csv/i })).toBeInTheDocument();
  });

  it("does not ship raw officer/charges to a role outside the vigilance reader set", async () => {
    sessionRoles = ["dept_head"];
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "v1", caseNo: "V-1", officer: "SECRET-OFFICER-NAME", charges: "SECRET-CHARGE-TEXT", inquiryStatus: "under_investigation", outcome: "pending" }],
      source: "api",
    });
    const tree = await VigilancePage();
    const { container } = render(tree);
    expect(JSON.stringify(tree, (_k, v) => (typeof v === "function" ? undefined : v))).not.toContain("SECRET-");
    expect(container.innerHTML).not.toContain("SECRET-");
  });
});
