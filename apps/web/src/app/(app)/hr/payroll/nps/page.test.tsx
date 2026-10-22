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

describe("NpsStatementsPage contribution base (GAP-PAYROLL-STATUTORY-NPS-05)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("shows the contribution base (Basic + DA) next to the contributions it produced, labelled and in exact rupees", async () => {
    mockNps({
      data: [{ id: "n1", employeeId: UUID, employeeName: "Ravi Kumar", period: "2026-08", basicMinor: 1500000, pensionBaseMinor: 2325000, empContribMinor: 232500, erContribMinor: 325500 }],
      source: "api",
    });
    render(await NpsStatementsPage());
    expect(screen.getByRole("columnheader", { name: /Contribution base/ })).toBeInTheDocument();
    const row = screen.getByText("Ravi Kumar").closest("tr")!;
    // base ₹23,250.00 -> employee ₹2,325.00 / employer ₹3,255.00 (10% / 14% of the BASE, not of Basic ₹15,000.00)
    expect(row).toHaveTextContent("₹23,250.00");
    expect(row).toHaveTextContent("₹2,325.00");
    expect(row).toHaveTextContent("₹3,255.00");
    expect(row).not.toHaveTextContent("₹15,000.00");
    expect(screen.getByText(/Contribution base: the Basic \+ DA that the employee and employer percentages were applied to/)).toBeInTheDocument();
  });

  it("a statement recorded before the base was captured shows — in the base column, not a guess", async () => {
    mockNps({
      data: [{ id: "n1", employeeId: UUID, employeeName: "Anita Rao", period: "2026-01", basicMinor: 1000000, empContribMinor: 100000, erContribMinor: 140000 }],
      source: "api",
    });
    render(await NpsStatementsPage());
    const cells = screen.getByText("Anita Rao").closest("tr")!.querySelectorAll("td");
    const headers = Array.from(document.querySelectorAll("th")).map((h) => h.textContent ?? "");
    const baseIdx = headers.findIndex((h) => /Contribution base/.test(h));
    expect(baseIdx).toBeGreaterThanOrEqual(0);
    expect(cells[baseIdx]).toHaveTextContent("—");
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
