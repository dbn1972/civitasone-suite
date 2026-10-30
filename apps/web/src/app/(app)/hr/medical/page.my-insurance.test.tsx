import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => ["employee"] }));
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...args: unknown[]) => fetchJsonMock(...args) }));
vi.mock("@/lib/entityAdapters/employee", () => ({ mapEmployeeOptions: vi.fn(), resolveEmployees: vi.fn(async () => []), searchEmployees: vi.fn(async () => []) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import MedicalPage from "./page";

const MY_ID = "6d1f1c1e-0000-4000-8000-000000000001";
const RECORD = {
  employeeId: MY_ID, schemeType: "esic", schemeId: null, cardNumber: "ESIC-TEST-55554321", cardNumberMasked: false,
  decryptFailed: false, validityFrom: "2026-01-01", validityTo: null, tier: null, dependants: [], dependantsCount: 0, annualLimitMinor: null,
};

function mockApi(profile: { data: unknown; source: string; status?: number }) {
  fetchJsonMock.mockImplementation(async (path: string) => {
    if (path === "/api/v1/hrms/me/profile") return profile;
    if (path.startsWith("/api/v1/hrms/medical/insurance")) return { data: RECORD, source: "api" };
    return { data: [], source: "api" };
  });
}

async function renderPage() {
  const ui = await MedicalPage();
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("MedicalPage — My medical insurance (self-service)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("shows the caller's own insurance, read for their own linked employee id", async () => {
    mockApi({ data: { id: MY_ID, name: "Me" }, source: "api" });
    await renderPage();
    expect(screen.getByText(enMessages.medicalClaims.myInsuranceTitle)).toBeInTheDocument();
    expect(screen.getByTestId("insurance-card-number")).toHaveTextContent("ESIC-TEST-55554321");
    expect(fetchJsonMock).toHaveBeenCalledWith(`/api/v1/hrms/medical/insurance?employeeId=${MY_ID}`, null, expect.anything());
    // Self-service is read-only: no HR edit control here.
    expect(screen.queryByRole("button", { name: enMessages.medicalInsurance.editButton })).not.toBeInTheDocument();
  });

  it("no linked employee profile: no self-service card and no insurance read", async () => {
    mockApi({ data: null, source: "error", status: 404 });
    await renderPage();
    expect(screen.queryByText(enMessages.medicalClaims.myInsuranceTitle)).not.toBeInTheDocument();
    expect(fetchJsonMock.mock.calls.some(([p]) => String(p).startsWith("/api/v1/hrms/medical/insurance"))).toBe(false);
  });
});
