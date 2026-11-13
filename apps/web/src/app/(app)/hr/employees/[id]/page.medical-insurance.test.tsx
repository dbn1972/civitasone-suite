import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const getEmployeeByIdMock = vi.fn();
// M2/M7: the page reads the tenant module list (Payroll switch); unknown list = everything on, as before.
vi.mock("@/lib/moduleVisibility", () => ({ getEnabledModules: async () => null }));
vi.mock("../../../../_data/loaders", () => ({ getEmployeeById: (...a: unknown[]) => getEmployeeByIdMock(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../../payroll/pay-groups/payGroupData", () => ({ getEmployeePayGroup: async () => ({ source: "api", data: { current: null, history: [] } }) }));
let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => mockRoles, PAYROLL_READER_ROLES: ["payroll_admin"] }));
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

import EmployeeDetailPage from "./page";

const m = enMessages.medicalInsurance;
const EMP_ID = "8cf7f7eb-1de6-4a31-b48c-1f598ecf33c0";
const EMP = { id: EMP_ID, employeeId: "EMP001", name: "Priya Sharma", department: "Finance", designation: "Section Officer", joiningDate: "2020-01-15", status: "confirmed" };
const RECORD = {
  employeeId: EMP_ID, schemeType: "cghs", schemeId: null, cardNumber: "**************1234", cardNumberMasked: true,
  decryptFailed: false, validityFrom: "2026-04-01", validityTo: null, tier: null, dependants: [], dependantsCount: 0, annualLimitMinor: null,
};

// UX-R5 perf (S-11): the insurance read publishes a DPDP audit-on-read and waited ~4.5 s for the broker on UAT,
// so the card now loads in the browser after the page (DeferredSections.tsx) through the proxy. The role gating
// and the card states asserted here are unchanged; only the transport moved from the server loader to fetch.
const INSURANCE_PROXY = "/api/proxy/v1/hrms/medical/insurance";
const browserFetch = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The hrms-service wire shape (snake_case) the browser receives for RECORD. */
function toWire(r: typeof RECORD) {
  return {
    employee_id: r.employeeId, scheme_type: r.schemeType, scheme_id: r.schemeId, card_number: r.cardNumber,
    card_number_masked: r.cardNumberMasked, decrypt_failed: r.decryptFailed, validity_from: r.validityFrom,
    validity_to: r.validityTo, tier: r.tier, dependants: r.dependants, dependants_count: r.dependantsCount,
    annual_limit_minor: r.annualLimitMinor,
  };
}

/** insurance: a record -> 200; null -> 404 (no record on file); "error" -> 500. */
async function renderPage(roles: string[], insurance: unknown = RECORD) {
  mockRoles = roles;
  getEmployeeByIdMock.mockResolvedValue({ data: EMP, source: "api" });
  fetchJsonMock.mockImplementation(async (_u: string, fallback: unknown) => ({ data: fallback, source: "api" }));
  browserFetch.mockImplementation(async (u: string) => {
    if (!String(u).startsWith(INSURANCE_PROXY)) return json({ data: [] });
    if (insurance === "error") return json({ code: "INTERNAL" }, 500);
    return insurance === null ? json({ code: "NOT_FOUND" }, 404) : json({ data: toWire(insurance as typeof RECORD) });
  });
  const ui = await EmployeeDetailPage({ params: Promise.resolve({ id: EMP_ID }) });
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}
const insuranceCalls = () => browserFetch.mock.calls.filter(([u]) => String(u).startsWith(INSURANCE_PROXY));

describe("EmployeeDetailPage medical insurance card", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); getEmployeeByIdMock.mockReset(); browserFetch.mockReset(); vi.stubGlobal("fetch", browserFetch); });
  afterEach(() => vi.unstubAllGlobals());

  it.each([["hr_admin"], ["super_admin"]])("%s sees the masked card with the audited Reveal action, and the edit control", async (role) => {
    await renderPage([role]);
    expect(screen.getByText(m.title)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Reveal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: m.editButton })).toBeInTheDocument();
    expect(insuranceCalls()[0]![0]).toBe(`${INSURANCE_PROXY}?employeeId=${EMP_ID}`);
  });

  it("hr_officer may edit but has no Reveal (reveal is the PAN / bank tier: hr_admin, super_admin)", async () => {
    await renderPage(["hr_officer"]);
    expect(await screen.findByRole("button", { name: m.editButton })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
  });

  it("finance_officer sees the masked card read-only: no edit control, no Reveal", async () => {
    await renderPage(["finance_officer"]);
    expect(await screen.findByTestId("insurance-card-number")).toHaveTextContent("**************1234");
    expect(screen.queryByRole("button", { name: m.editButton })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
  });

  it("HR with no record on file gets 'add' instead of 'edit'", async () => {
    await renderPage(["hr_admin"], null);
    expect(await screen.findByText(m.noRecord)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: m.addButton })).toBeInTheDocument();
  });

  it("a manager sees the (server-masked) card read-only", async () => {
    await renderPage(["manager"]);
    expect(await screen.findByTestId("insurance-card-number")).toHaveTextContent("**************1234");
    expect(screen.queryByRole("button", { name: m.editButton })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
  });

  it("roles the backend would refuse never fetch it and see no card", async () => {
    await renderPage(["payroll_admin"]);
    await new Promise((r) => setTimeout(r, 20));
    expect(insuranceCalls()).toHaveLength(0);
    expect(screen.queryByText(m.title)).not.toBeInTheDocument();
  });

  it("a failed read shows 'unavailable' and no edit form (nothing to edit against)", async () => {
    await renderPage(["hr_admin"], "error");
    expect(await screen.findByText(m.unavailable)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: m.editButton })).not.toBeInTheDocument();
  });
});

describe("EmployeeDetailPage performance (UX-R5, S-11)", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); getEmployeeByIdMock.mockReset(); browserFetch.mockReset(); vi.stubGlobal("fetch", browserFetch); });
  afterEach(() => vi.unstubAllGlobals());

  it("starts the independent server reads together (pay group and the three lifecycle lists), not one after another", async () => {
    mockRoles = ["hr_admin", "payroll_admin"];
    getEmployeeByIdMock.mockResolvedValue({ data: { ...EMP, costCenterId: "cc-1" }, source: "api" });
    browserFetch.mockImplementation(async () => json({ data: [] }));
    const started: string[] = [];
    const gate: Array<() => void> = [];
    // Every read waits until ALL expected reads have started: a sequential page would deadlock (timeout) here.
    fetchJsonMock.mockImplementation((u: string, fallback: unknown) => {
      started.push(String(u));
      return new Promise((resolve) => {
        gate.push(() => resolve({ data: fallback, source: "api" }));
        if (started.length >= 4) for (const g of gate.splice(0)) g();
      });
    });
    const page = EmployeeDetailPage({ params: Promise.resolve({ id: EMP_ID }) });
    await page;
    expect(started.some((u) => u.startsWith("/api/v1/finance/cost-centers"))).toBe(true);
    expect(started.some((u) => u.startsWith("/api/v1/hrms/lifecycle/transfers"))).toBe(true);
    expect(started.some((u) => u.startsWith("/api/v1/hrms/lifecycle/promotions"))).toBe(true);
    expect(started.some((u) => u.startsWith("/api/v1/hrms/deputation"))).toBe(true);
  });

  it("never reads scanned documents or medical insurance on the server (they load after the page)", async () => {
    await renderPage(["hr_admin"]);
    const serverPaths = fetchJsonMock.mock.calls.map(([u]) => String(u));
    expect(serverPaths.some((u) => u.includes("/scanned-documents"))).toBe(false);
    expect(serverPaths.some((u) => u.includes("/medical/insurance"))).toBe(false);
    expect(await screen.findByRole("button", { name: "Reveal" })).toBeInTheDocument();
    expect(browserFetch.mock.calls.some(([u]) => String(u) === `/api/proxy/v1/hrms/employees/${EMP_ID}/scanned-documents`)).toBe(true);
  });
});
