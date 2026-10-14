import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const getEmployeeByIdMock = vi.fn();
vi.mock("../../../../_data/loaders", () => ({ getEmployeeById: (...a: unknown[]) => getEmployeeByIdMock(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const payGroupMock = vi.fn();
vi.mock("../../payroll/pay-groups/payGroupData", () => ({ getEmployeePayGroup: (...a: unknown[]) => payGroupMock(...a) }));
let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => mockRoles, PAYROLL_READER_ROLES: ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"] }));
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

import EmployeeDetailPage from "./page";

const EMP_ID = "8cf7f7eb-1de6-4a31-b48c-1f598ecf33c0";
const EMP = {
  id: EMP_ID, employeeId: "EMP001", name: "Priya Sharma", department: "Finance", designation: "Section Officer",
  joiningDate: "2020-01-15", status: "confirmed", phone: "******3210", pan: "******234F",
  bankAccountNo: "********7890", bankIfsc: "SBIN0001234",
};

async function renderPage(roles: string[]) {
  mockRoles = roles;
  getEmployeeByIdMock.mockResolvedValue({ data: EMP, source: "api" });
  payGroupMock.mockResolvedValue({ source: "api", data: { current: null, history: [] } });
  fetchJsonMock.mockImplementation(async (_u: string, fallback: unknown) => ({ data: fallback, source: "api" }));
  const ui = await EmployeeDetailPage({ params: { id: EMP_ID } });
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}
const revealButtons = () => screen.queryAllByRole("button", { name: "Reveal" });

describe("EmployeeDetailPage PII: masked by default, audited reveal (W1 SF-05a)", () => {
  beforeEach(() => { getEmployeeByIdMock.mockReset(); vi.restoreAllMocks(); });
  afterEach(() => { vi.useRealTimers(); });

  // Policy change (owner decision 3, 2026-10-14): IFSC is a public branch code and
  // is shown in full with no reveal control. Phone, PAN and bank account stay masked.
  it("hr_admin sees phone/PAN/account masked and the IFSC in full; nothing is fetched until a reveal is confirmed", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await renderPage(["hr_admin"]);
    for (const masked of ["******3210", "******234F", "********7890"]) {
      expect(screen.getByText(masked)).toBeInTheDocument();
    }
    expect(screen.getByText("SBIN0001234")).toBeInTheDocument();
    expect(revealButtons()).toHaveLength(3);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("revealing PAN asks for a reason, calls the audited hrms endpoint once, shows the clear value", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ data: { value: "ABCDE1234F" } }), { status: 200 }));
    await renderPage(["hr_admin"]);
    // buttons render in page order: phone, PAN, bank account
    fireEvent.click(revealButtons()[1]!);
    fireEvent.change(await screen.findByLabelText(/Reason for revealing/i), { target: { value: "verify PAN for Form 16" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Reveal" }).pop()!);

    expect(await screen.findByText("ABCDE1234F")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/hrms/pii/reveal");
    expect(JSON.parse(init.body as string)).toEqual({
      resourceType: "employee", resourceId: EMP_ID, field: "pan", reason: "verify PAN for Form 16",
    });
  });

  it("a forbidden reveal (403) keeps the value masked and says so", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "FORBIDDEN" }), { status: 403 }));
    await renderPage(["hr_admin"]);
    fireEvent.click(revealButtons()[0]!);
    fireEvent.change(await screen.findByLabelText(/Reason for revealing/i), { target: { value: "call about leave form" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Reveal" }).pop()!);
    expect(await screen.findByText(enMessages.piiReveal.forbidden)).toBeInTheDocument();
    expect(screen.getByText("******3210")).toBeInTheDocument();
  });

  it("hr_officer may reveal the phone only; PAN / bank account stay masked with no reveal control; IFSC is shown in full", async () => {
    await renderPage(["hr_officer"]);
    expect(revealButtons()).toHaveLength(1);
    expect(screen.getByText("******234F")).toBeInTheDocument();
    expect(screen.getByText("********7890")).toBeInTheDocument();
    expect(screen.getByText("SBIN0001234")).toBeInTheDocument();
  });

  it("a manager sees the phone masked with no reveal control and no bank card", async () => {
    await renderPage(["manager"]);
    expect(screen.getByText("******3210")).toBeInTheDocument();
    expect(revealButtons()).toHaveLength(0);
    expect(screen.queryByText("******234F")).not.toBeInTheDocument();
  });
});
