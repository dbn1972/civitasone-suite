import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

let mockRoles: string[] = ["hr_admin"];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

const resolveEmployeesMock = vi.fn();
vi.mock("@/lib/entityAdapters/employee", () => ({
  resolveEmployees: (...args: unknown[]) => resolveEmployeesMock(...args),
  searchEmployees: vi.fn(async () => []),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import MedicalPage from "./page";

// MedicalClaimsTable/ClaimActions are client components using useTranslations
// (not the server-side getTranslations the page itself uses) -- same
// convention as LeaveApprovalsPanel.test.tsx: needs a real
// NextIntlClientProvider ancestor, not a bare render().
function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const BASE_CLAIM = {
  id: "claim-1",
  claim_no: 7,
  employee_id: "emp-1",
  claim_type: "outdoor",
  amount_minor: "500000",
  hospital_name: "AIIMS",
  status: "pending",
  dependant_name: null,
  dependant_relation: null,
  approved_amount_minor: null,
  created_at: "2026-01-05T00:00:00.000Z",
};

describe("MedicalPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    resolveEmployeesMock.mockReset();
    resolveEmployeesMock.mockResolvedValue([{ id: "emp-1", label: "A. Kumar (E-100)" }]);
    mockRoles = ["hr_admin"];
  });

  it("shows the employee's real name (GAP-HR-MEDICAL-02), not just claim fields", async () => {
    fetchJsonMock.mockResolvedValue({ data: [BASE_CLAIM], source: "api" });
    const ui = await MedicalPage();
    renderWithIntl(ui);
    expect(screen.getByText("A. Kumar (E-100)")).toBeInTheDocument();
    expect(resolveEmployeesMock).toHaveBeenCalledWith(["emp-1"]);
  });

  it("shows the real claim_no in the Claim Ref column, not a fabricated reference (GAP-HR-MEDICAL-04)", async () => {
    fetchJsonMock.mockResolvedValue({ data: [BASE_CLAIM], source: "api" });
    const ui = await MedicalPage();
    renderWithIntl(ui);
    expect(screen.getByText("MED-000007")).toBeInTheDocument();
    expect(screen.queryByText(/^MED\/[0-9A-F]{8}$/)).not.toBeInTheDocument();
  });

  it("counts a 'settled' claim as Approved / Settled, not silently uncounted (GAP-HR-MEDICAL-03)", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { ...BASE_CLAIM, id: "c1", status: "approved" },
        { ...BASE_CLAIM, id: "c2", status: "settled" },
        { ...BASE_CLAIM, id: "c3", status: "pending" },
        { ...BASE_CLAIM, id: "c4", status: "rejected" },
      ],
      source: "api",
    });
    const ui = await MedicalPage();
    renderWithIntl(ui);
    const approvedCard = screen.getByText("Approved / Settled").closest(".stat");
    expect(approvedCard!.querySelector(".val")?.textContent).toBe("2");
    // "Pending" also appears as a row's StatusPill label -- the stat label
    // is the one inside a ".stat" card specifically.
    const pendingLabel = screen.getAllByText("Pending").find((el) => el.closest(".stat"));
    const pendingCard = pendingLabel!.closest(".stat");
    expect(pendingCard!.querySelector(".val")?.textContent).toBe("1");
  });

  it("translates the claim type instead of printing the raw enum (GAP-HR-MEDICAL-06)", async () => {
    fetchJsonMock.mockResolvedValue({ data: [BASE_CLAIM], source: "api" });
    const ui = await MedicalPage();
    renderWithIntl(ui);
    expect(screen.queryByText("outdoor", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText("Outdoor (Outpatient)")).toBeInTheDocument();
  });

  it("renders a File Claim link instead of the old empty actions span (GAP-HR-MEDICAL-05/06)", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await MedicalPage();
    renderWithIntl(ui);
    const link = screen.getByRole("link", { name: "File Claim" });
    expect(link).toHaveAttribute("href", "/hr/medical/new");
  });

  it("shows approve/reject actions for an HR role but not for a bare employee viewing their own claims", async () => {
    fetchJsonMock.mockResolvedValue({ data: [BASE_CLAIM], source: "api" });

    mockRoles = ["hr_admin"];
    const hrUi = await MedicalPage();
    const { unmount } = renderWithIntl(hrUi);
    expect(screen.getByText("Approve")).toBeInTheDocument();
    unmount();

    mockRoles = ["employee"];
    const empUi = await MedicalPage();
    renderWithIntl(empUi);
    expect(screen.queryByText("Approve")).not.toBeInTheDocument();
  });
});
