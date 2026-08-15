import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("./MedicalClaimForm", () => ({
  MedicalClaimForm: () => <div data-testid="medical-claim-form" />,
}));

import MedicalPage from "./page";

const MOCK_CLAIMS = [
  {
    id: "m1",
    employee: { name: "Geeta Verma", employeeNo: "EMP021" },
    treatmentDate: "2026-07-10",
    hospital: "AIIMS Delhi",
    diagnosis: "Hypertension",
    claimType: "Outdoor" as const,
    amountMinor: 350000,
    cghsWard: "Semi-Private",
    referralStatus: "Not Required",
    status: "Approved",
  },
  {
    id: "m2",
    employee: { name: "Mohan Das", employeeNo: "EMP022" },
    treatmentDate: "2026-07-15",
    hospital: "Safdarjung Hospital",
    diagnosis: "Appendicitis — Surgery",
    claimType: "Indoor" as const,
    amountMinor: 8500000,
    cghsWard: "General",
    referralStatus: "Referred — CGHS Approved",
    status: "Pending",
  },
];

describe("MedicalPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders page title with CGHS reference", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_CLAIMS, source: "api" });
    render(await MedicalPage());
    expect(screen.getByText("Medical Reimbursement")).toBeInTheDocument();
    expect(screen.getByText(/CGHS \/ CS\(MA\) Rules 1944/i)).toBeInTheDocument();
  });

  it("renders stat cards", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_CLAIMS, source: "api" });
    render(await MedicalPage());
    expect(screen.getByText("Total Claims")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Indoor")).toBeInTheDocument();
  });

  it("renders MedicalClaimForm", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_CLAIMS, source: "api" });
    render(await MedicalPage());
    expect(screen.getByTestId("medical-claim-form")).toBeInTheDocument();
  });

  it("shows employee data in table", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_CLAIMS, source: "api" });
    render(await MedicalPage());
    expect(screen.getByText(/Geeta Verma/)).toBeInTheDocument();
    expect(screen.getByText("AIIMS Delhi")).toBeInTheDocument();
  });

  it("shows empty state when no claims", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await MedicalPage());
    expect(screen.getByText(/No medical claims/i)).toBeInTheDocument();
    expect(screen.getByText(/CS\(MA\) Rules/i)).toBeInTheDocument();
  });

  it("shows CGHS Ward and Referral column headers", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_CLAIMS, source: "api" });
    render(await MedicalPage());
    expect(screen.getByText("CGHS Ward")).toBeInTheDocument();
    expect(screen.getByText("Referral")).toBeInTheDocument();
    expect(screen.getByText("Treatment Date")).toBeInTheDocument();
  });
});
