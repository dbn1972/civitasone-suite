import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("../_components/MoneyChart", () => ({
  MoneyChart: () => null,
}));
const getSessionRolesMock = vi.fn(() => ["payroll_officer"]);
vi.mock("@/lib/auth/roleGuard", async (io) => ({
  ...(await io<typeof import("@/lib/auth/roleGuard")>()),
  getSessionRoles: () => getSessionRolesMock(),
}));

import GpfStatementsPage from "./page";

const UUID = "3f2a9c1e-0000-4000-8000-000000000001";

function mockGpf(result: { data: unknown; source: "api" | "error" }) {
  fetchJsonMock.mockImplementation((path: unknown) => {
    if (typeof path === "string" && path.includes("/payroll/statutory/gpf")) return Promise.resolve(result);
    return Promise.resolve({ data: [], source: "api" });
  });
}

describe("GpfStatementsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReturnValue(["payroll_officer"]);
  });

  it("renders the GPF ledger and real stat counts on success", async () => {
    mockGpf({ data: [{ id: "g1", employeeId: UUID, period: "2026-08", empContribMinor: 500000 }], source: "api" });
    render(await GpfStatementsPage());
    const statLabel = screen.getAllByText("Statements").find((el) => el.classList.contains("lab"));
    expect(statLabel?.parentElement).toHaveTextContent("1");
  });

  it("shows the honest empty state when a tenant genuinely has zero GPF statements", async () => {
    mockGpf({ data: [], source: "api" });
    render(await GpfStatementsPage());
    expect(screen.getByText("No GPF statements")).toBeInTheDocument();
    expect(screen.getAllByText("₹0.00").length).toBeGreaterThan(0);
  });

  it("shows the error state and no fabricated ₹0 on a real fetch failure", async () => {
    mockGpf({ data: [], source: "error" });
    render(await GpfStatementsPage());
    expect(screen.getByText("We couldn't load GPF statements.")).toBeInTheDocument();
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
  });

  it("shows the employee's real name and HR employee code (UX-021, GAP-PAYROLL-GPF-02)", async () => {
    mockGpf({ data: [{ id: "g1", employeeId: UUID, employeeName: "Priya Verma", employeeCode: "EMP-0042", period: "2026-08", empContribMinor: 500000 }], source: "api" });
    render(await GpfStatementsPage());
    expect(screen.getByText("Priya Verma")).toBeInTheDocument();
    expect(screen.getByText("EMP-0042")).toBeInTheDocument();
  });

  it("GAP-PAYROLL-GPF-02: never shows UUID-derived text; a missing name reads 'Unknown employee'", async () => {
    mockGpf({ data: [{ id: "g1", employeeId: UUID, employeeName: null, employeeCode: null, period: "2026-08", empContribMinor: 500000 }], source: "api" });
    const { container } = render(await GpfStatementsPage());
    expect(screen.getByText("Unknown employee")).toBeInTheDocument();
    expect(container.textContent).not.toContain("3F2A9C1E");
    expect(container.textContent?.toLowerCase()).not.toContain("3f2a9c1e");
  });

  it("GAP-PAYROLL-GPF-04: a missing contribution renders — (not ₹0.00) and is flagged; a real zero renders ₹0.00", async () => {
    mockGpf({
      data: [
        { id: "g1", employeeId: UUID, employeeName: "A", employeeCode: "E1", period: "2026-08" },
        { id: "g2", employeeId: "3f2a9c1e-0000-4000-8000-000000000002", employeeName: "B", employeeCode: "E2", period: "2026-08", empContribMinor: 0 },
      ],
      source: "api",
    });
    render(await GpfStatementsPage());
    const rowA = screen.getByText("A").closest("tr")!;
    const rowB = screen.getByText("B").closest("tr")!;
    expect(rowA).toHaveTextContent("—");
    expect(rowA).not.toHaveTextContent("₹0.00");
    expect(rowB).toHaveTextContent("₹0.00");
    expect(screen.getByText(/1 statement has no contribution figure/)).toBeInTheDocument();
  });

  it("GAP-PAYROLL-GPF-03: no duplicate/mislabelled corpus tiles and no hard-coded rate in the column header", async () => {
    mockGpf({ data: [{ id: "g1", employeeId: UUID, employeeName: "A", period: "2026-08", empContribMinor: 500000 }], source: "api" });
    const { container } = render(await GpfStatementsPage());
    expect(screen.queryByText(/Accumulated Corpus/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Projected Value/i)).not.toBeInTheDocument();
    expect(screen.getAllByText("Total Contributions")).toHaveLength(1);
    expect(screen.getByText("Employee GPF")).toBeInTheDocument();
    expect(container.textContent).not.toContain("(10%)");
  });

  it("GAP-PAYROLL-GPF-05: an employee-role session sees PermissionDenied and no statutory fetch is made", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    render(await GpfStatementsPage());
    expect(fetchJsonMock).not.toHaveBeenCalled();
    expect(screen.queryByText("GPF Ledger")).not.toBeInTheDocument();
  });
});

describe("GpfStatementsPage HRMS reconciliation (GAP-PAYROLL-STATUTORY-GPF-02)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReturnValue(["payroll_officer"]);
  });

  it("shows each row's verdict and a review note when a ledger row differs from the HRMS GPF account", async () => {
    mockGpf({
      data: [
        { id: "g1", employeeId: UUID, employeeName: "Priya Verma", period: "2026-08", empContribMinor: 500000, reconciliation: { status: "match" } },
        { id: "g2", employeeId: UUID, employeeName: "Ravi Kumar", period: "2026-08", empContribMinor: 500000, reconciliation: { status: "mismatch" } },
      ],
      source: "api",
    });
    render(await GpfStatementsPage());
    expect(screen.getByText("Matches HRMS account")).toBeInTheDocument();
    expect(screen.getByText("Differs from HRMS account")).toBeInTheDocument();
    expect(screen.getByText(/1 row differs from or has no matching HRMS account/)).toBeInTheDocument();
  });

  it("makes no claim when the server sent no verdict (HRMS not checked) and shows no review note", async () => {
    mockGpf({ data: [{ id: "g1", employeeId: UUID, period: "2026-08", empContribMinor: 500000 }], source: "api" });
    render(await GpfStatementsPage());
    expect(screen.getByText("HRMS not checked")).toBeInTheDocument();
    expect(screen.queryByText(/differs from or has no matching HRMS account/)).not.toBeInTheDocument();
  });
});
