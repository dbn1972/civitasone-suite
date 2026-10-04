import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("../_components/MoneyChart", () => ({
  MoneyChart: () => null,
}));
const getSessionRolesMock = vi.fn(() => ["payroll_admin"]);
vi.mock("@/lib/auth/roleGuard", async (io) => ({
  ...(await io<typeof import("@/lib/auth/roleGuard")>()),
  getSessionRoles: () => getSessionRolesMock(),
}));

import NpsStatementsPage from "./page";

const UUID = "7c1d2e3f-0000-4000-8000-000000000001";

function mockNps(result: { data: unknown; source: "api" | "error" }) {
  fetchJsonMock.mockImplementation(() => Promise.resolve(result));
}

describe("NpsStatementsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("GAP-PAYROLL-NPS-02: shows the HR employee code and a masked PRAN (last 4 only), never a UUID prefix", async () => {
    mockNps({ data: [{ id: "n1", employeeId: UUID, employeeName: "Ravi Kumar", employeeCode: "EMP-0007", pranLast4: "9012", period: "2026-08", empContribMinor: 500000, erContribMinor: 700000 }], source: "api" });
    const { container } = render(await NpsStatementsPage());
    expect(screen.getByText("EMP-0007")).toBeInTheDocument();
    expect(screen.getByText("•••• 9012")).toBeInTheDocument();
    expect(container.textContent?.toUpperCase()).not.toContain("7C1D2E3F");
  });

  it("GAP-PAYROLL-NPS-02: a row without code/PRAN/name renders '—' and 'Unknown employee', not an 8-char hex", async () => {
    mockNps({ data: [{ id: "n1", employeeId: UUID, employeeName: null, employeeCode: null, pranLast4: null, period: "2026-08", empContribMinor: 500000, erContribMinor: 700000 }], source: "api" });
    const { container } = render(await NpsStatementsPage());
    expect(screen.getByText("Unknown employee")).toBeInTheDocument();
    expect(container.textContent?.toUpperCase()).not.toContain("7C1D2E3F");
  });

  it("GAP-PAYROLL-NPS-03: a null contribution renders — and is excluded from totals; no 10%/14% literals remain", async () => {
    mockNps({
      data: [
        { id: "n1", employeeId: UUID, employeeName: "A", period: "2026-08", empContribMinor: 500000 },
        { id: "n2", employeeId: "7c1d2e3f-0000-4000-8000-000000000002", employeeName: "B", period: "2026-08", empContribMinor: 100000, erContribMinor: 140000 },
      ],
      source: "api",
    });
    const { container } = render(await NpsStatementsPage());
    expect(screen.getByText("A").closest("tr")).toHaveTextContent("—");
    expect(screen.getByText("Total Employer Contribution").parentElement).toHaveTextContent("₹1,400.00");
    expect(container.textContent).not.toMatch(/\b1[04]%/);
    const nps = JSON.stringify(enMessages.npsStatements);
    expect(nps).not.toMatch(/10%|14%/);
  });

  it("GAP-PAYROLL-NPS-04: the combined tile is 'Total Contributions' and no corpus wording remains", async () => {
    mockNps({ data: [{ id: "n1", employeeId: UUID, employeeName: "A", period: "2026-08", empContribMinor: 500000, erContribMinor: 700000 }], source: "api" });
    const { container } = render(await NpsStatementsPage());
    expect(screen.getByText("Total Contributions")).toBeInTheDocument();
    expect(container.textContent?.toLowerCase()).not.toContain("corpus");
    // String VALUES only (a legacy key name like accumulatedCorpusNote is not user-facing).
    expect(Object.values(enMessages.npsStatements).join(" ").toLowerCase()).not.toContain("corpus");
  });

  it("GAP-PAYROLL-NPS-05: employee role renders PermissionDenied and issues no statutory fetch", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    render(await NpsStatementsPage());
    expect(fetchJsonMock).not.toHaveBeenCalled();
    expect(screen.queryByText("NPS Ledger")).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-NPS-05: payroll_admin renders the ledger", async () => {
    mockNps({ data: [{ id: "n1", employeeId: UUID, employeeName: "A", period: "2026-08", empContribMinor: 1, erContribMinor: 1 }], source: "api" });
    render(await NpsStatementsPage());
    expect(screen.getByText("NPS Ledger")).toBeInTheDocument();
  });
});

describe("NpsStatementsPage HRMS reconciliation (GAP-PAYROLL-STATUTORY-NPS-02)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("flags a row whose contribution percentages differ from the HRMS NPS account, and one with no account", async () => {
    mockNps({
      data: [
        { id: "n1", employeeId: UUID, employeeName: "Ravi Kumar", period: "2026-08", empContribMinor: 500000, erContribMinor: 700000, reconciliation: { status: "mismatch" } },
        { id: "n2", employeeId: UUID, employeeName: "Anita Rao", period: "2026-08", empContribMinor: 500000, erContribMinor: 700000, reconciliation: { status: "no_hrms_account" } },
      ],
      source: "api",
    });
    render(await NpsStatementsPage());
    expect(screen.getByText("Differs from HRMS account")).toBeInTheDocument();
    expect(screen.getByText("No HRMS account")).toBeInTheDocument();
    expect(screen.getByText(/2 rows differ from or have no matching HRMS account/)).toBeInTheDocument();
  });
});
