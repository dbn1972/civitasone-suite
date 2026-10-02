import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
const getSessionRolesMock = vi.fn(() => ["payroll_admin"]);
const getSessionUserIdMock = vi.fn<() => string | null>(() => ME);
vi.mock("@/lib/auth/roleGuard", async (io) => ({
  ...(await io<typeof import("@/lib/auth/roleGuard")>()),
  getSessionRoles: () => getSessionRolesMock(),
  getSessionUserId: () => getSessionUserIdMock(),
}));

import FnfPage from "./page";

const EMP = "9b8c7d6e-0000-4000-8000-000000000001";
const ME = "11111111-0000-4000-8000-0000000000aa";
const OTHER = "22222222-0000-4000-8000-0000000000bb";

async function renderPage() {
  const ui = await FnfPage();
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("FnfPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
    getSessionUserIdMock.mockReturnValue(ME);
  });

  it("GAP-PAYROLL-FNF-05: a card shows the employee name, HR code, translated separation type and an Indian-format date -- never the UUID", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "s1", employeeId: EMP, employeeName: "Meera Iyer", employeeCode: "EMP-0451", separationType: "retirement", separationDate: "2026-07-01", netPayableMinor: "500000", status: "draft" }],
      source: "api",
    });
    const { container } = await renderPage();
    expect(screen.getByText("Meera Iyer")).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.textContent === "EMP-0451 · Retirement · 01 Jul 2026")).toBeInTheDocument();
    expect(container.textContent).not.toContain(EMP);
  });

  it("GAP-PAYROLL-FNF-05: an unresolved employee reads 'Unknown employee', not the UUID", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "s1", employeeId: EMP, employeeName: null, employeeCode: null, separationType: "vrs", separationDate: "2026-07-01", netPayableMinor: "500000", status: "draft" }],
      source: "api",
    });
    const { container } = await renderPage();
    expect(screen.getByText("Unknown employee")).toBeInTheDocument();
    expect(container.textContent).not.toContain(EMP);
  });

  // GAP-PAYROLL-FNF-01: the workflow buttons are back, gated by role AND
  // status AND segregation of duties.
  const row = (id: string, name: string, status: string, extra: Record<string, unknown> = {}) => ({
    id, employeeId: EMP, employeeName: name, separationType: "retirement", separationDate: "2026-07-01",
    netPayableMinor: "100000", status, version: 2, computedBy: OTHER, submittedBy: null, financeApprovedBy: null, ...extra,
  });
  const btn = (label: RegExp, name: string) => screen.queryByRole("button", { name: new RegExp(`(${label.source}).*${name}`, "i") });

  it("GAP-PAYROLL-FNF-01: payroll_admin sees the next step for each status, never on their own work", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        row("s1", "Asha", "computed"),
        row("s2", "Bala", "submitted", { submittedBy: OTHER }),
        row("s3", "Chitra", "submitted", { submittedBy: ME }),
        row("s4", "Dev", "submitted", { submittedBy: OTHER, computedBy: ME }),
        row("s5", "Esha", "finance_approved", { submittedBy: OTHER, financeApprovedBy: OTHER }),
        row("s6", "Farid", "finance_approved", { submittedBy: OTHER, financeApprovedBy: ME }),
        row("s7", "Gita", "disbursed", { paymentReference: "UTR-0001", paymentDate: "2026-09-30" }),
        row("s8", "Hari", "computed", { version: undefined }),
        row("s9", "Indu", "rejected", { rejectionReason: "leave balance is wrong" }),
        row("s10", "Jaya", "finance_approved", { submittedBy: ME, financeApprovedBy: OTHER }),
        row("s11", "Kiran", "finance_approved", { submittedBy: OTHER, financeApprovedBy: OTHER, computedBy: ME }),
      ],
      source: "api",
    });
    await renderPage();
    expect(btn(/submit/, "Asha")).toBeInTheDocument();
    expect(btn(/finance-approve/, "Bala")).toBeInTheDocument();
    expect(btn(/reject/, "Bala")).toBeInTheDocument();
    expect(btn(/finance-approve|reject/, "Chitra")).not.toBeInTheDocument();
    expect(btn(/finance-approve|reject/, "Dev")).not.toBeInTheDocument();
    expect(screen.getAllByText(/someone else must approve or reject it/)).toHaveLength(2);
    expect(btn(/record the payment/, "Esha")).toBeInTheDocument();
    expect(btn(/reject/, "Esha")).toBeInTheDocument();
    expect(btn(/record the payment|reject/, "Farid")).not.toBeInTheDocument();
    expect(btn(/record the payment|reject/, "Jaya")).not.toBeInTheDocument();
    expect(btn(/record the payment|reject/, "Kiran")).not.toBeInTheDocument();
    expect(screen.getAllByText(/someone else must record its payment/)).toHaveLength(3);
    expect(btn(/submit|approve|payment|reject/, "Gita")).not.toBeInTheDocument();
    expect(screen.getByText(/reference UTR-0001, dated 30 Sep 2026/)).toBeInTheDocument();
    expect(btn(/submit/, "Hari")).not.toBeInTheDocument();
    expect(btn(/submit|approve|payment|reject/, "Indu")).not.toBeInTheDocument();
    expect(screen.getByText(/Rejected: leave balance is wrong/)).toBeInTheDocument();
    expect(screen.queryByText(/not available in this system/)).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-FNF-01: finance_officer can approve/reject a submitted settlement but cannot submit or disburse", async () => {
    getSessionRolesMock.mockReturnValue(["finance_officer"]);
    fetchJsonMock.mockResolvedValue({
      data: [
        row("s1", "Asha", "computed"),
        row("s2", "Bala", "submitted", { submittedBy: OTHER }),
        row("s3", "Chitra", "finance_approved", { submittedBy: OTHER, financeApprovedBy: OTHER }),
      ],
      source: "api",
    });
    await renderPage();
    expect(btn(/submit/, "Asha")).not.toBeInTheDocument();
    expect(btn(/finance-approve/, "Bala")).toBeInTheDocument();
    expect(btn(/record the payment|reject/, "Chitra")).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-FNF-01: payroll_officer can open the page and submit, but gets no compute form and no approval buttons", async () => {
    getSessionRolesMock.mockReturnValue(["payroll_officer"]);
    fetchJsonMock.mockResolvedValue({
      data: [row("s1", "Asha", "computed"), row("s2", "Bala", "submitted", { submittedBy: OTHER })],
      source: "api",
    });
    await renderPage();
    expect(screen.queryByText("Compute F&F Settlement")).not.toBeInTheDocument();
    expect(btn(/submit/, "Asha")).toBeInTheDocument();
    expect(btn(/finance-approve|reject/, "Bala")).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-FNF-01: hr_admin sees no workflow buttons (compute only)", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue({ data: [row("s1", "Asha", "computed"), row("s2", "Bala", "submitted", { submittedBy: OTHER })], source: "api" });
    await renderPage();
    expect(screen.queryByRole("button", { name: /submit the settlement|finance-approve|record the payment|reject the settlement/i })).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-FNF-01: no session user id -> no workflow buttons", async () => {
    getSessionUserIdMock.mockReturnValue(null);
    fetchJsonMock.mockResolvedValue({ data: [row("s1", "Asha", "computed")], source: "api" });
    await renderPage();
    expect(btn(/submit/, "Asha")).not.toBeInTheDocument();
  });

  it("renders an empty state when there are no settlements", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByText("No F&F settlements yet")).toBeInTheDocument();
  });

  it("shows the error data-source badge on API failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    await renderPage();
    expect(screen.getByText("Couldn't load F&F settlements — showing nothing")).toBeInTheDocument();
  });

  it.each([["employee"], ["manager"], ["hr_officer"]])(
    "GAP-PAYROLL-FNF-02: role %s gets PermissionDenied and no settlements fetch (mirrors payroll-service FNF_ROLES)",
    async (role) => {
      getSessionRolesMock.mockReturnValue([role]);
      await renderPage();
      expect(fetchJsonMock).not.toHaveBeenCalled();
      expect(screen.queryByText("Compute F&F Settlement")).not.toBeInTheDocument();
    },
  );

  it.each([["finance_officer"], ["hr_admin"], ["super_admin"]])("GAP-PAYROLL-FNF-02: role %s can open the page", async (role) => {
    getSessionRolesMock.mockReturnValue([role]);
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByText("Compute F&F Settlement")).toBeInTheDocument();
  });

  it("GAP-PAYROLL-FNF-04: submitted / finance_approved are counted as In Approval and the stat buckets sum to the total", async () => {
    const row = (id: string, status: string) => ({ id, employeeId: EMP, employeeName: "A", employeeCode: null, separationType: "vrs", separationDate: "2026-07-01", netPayableMinor: "1", status });
    fetchJsonMock.mockResolvedValue({
      data: [row("1", "computed"), row("2", "submitted"), row("3", "finance_approved"), row("4", "disbursed"), row("5", "rejected")],
      source: "api",
    });
    await renderPage();
    const statValue = (label: string) => screen.getByText(label).parentElement?.textContent ?? "";
    expect(statValue("In Approval")).toContain("2");
    expect(statValue("Pending / Draft")).toContain("2"); // computed + rejected
    expect(statValue("Settled / Disbursed")).toContain("1");
    expect(statValue("Total Settlements")).toContain("5");
  });
});
