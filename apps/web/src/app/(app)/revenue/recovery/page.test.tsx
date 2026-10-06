import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import RecoveryPage from "./page";

const ASSESSEE = {
  id: "11111111-1111-1111-1111-111111111111",
  ownerName: "Ravi Kumar",
  identifierNo: "PMC-0001",
  assesseeType: "residential",
};

describe("RecoveryPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("prompts for an assessee when none is selected", async () => {
    fetchJsonMock.mockResolvedValue({ data: [ASSESSEE], source: "api" });
    const ui = await RecoveryPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("Choose an assessee")).toBeInTheDocument();
  });

  it("renders the recovery referral form once an assessee is selected", async () => {
    fetchJsonMock.mockResolvedValue({ data: [ASSESSEE], source: "api" });
    const ui = await RecoveryPage({ searchParams: { assesseeId: ASSESSEE.id } });
    render(ui);

    expect(screen.getByRole("heading", { name: "Refer for Recovery" })).toBeInTheDocument();
  });

  it("renders the recovery register from the list endpoint (GAP-REVENUE-RECOVERY-02)", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: [ASSESSEE], source: "api" }) // assessees
      .mockResolvedValueOnce({
        data: [
          {
            id: "ref-1",
            assesseeId: ASSESSEE.id,
            reason: "Persistent non-payment",
            status: "referred",
            referredAt: "2026-01-02T10:00:00.000Z",
          },
        ],
        source: "api",
      }); // referrals

    const ui = await RecoveryPage({ searchParams: {} });
    render(ui);

    // Assessee name (not the UUID) and the reason are shown in the register.
    expect(screen.getByText("Ravi Kumar")).toBeInTheDocument();
    expect(screen.getByText("Persistent non-payment")).toBeInTheDocument();
  });

  it("shows a retry state when the register fails to load (GAP-REVENUE-RECOVERY-02)", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: [ASSESSEE], source: "api" }) // assessees ok
      .mockResolvedValueOnce({ data: [], source: "error" }); // referrals error

    const ui = await RecoveryPage({ searchParams: {} });
    render(ui);

    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });

  it("no longer leaks developer BACKEND FOLLOW-UPS text to end users (GAP-REVENUE-RECOVERY-04)", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: [ASSESSEE], source: "api" })
      .mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await RecoveryPage({ searchParams: {} });
    render(ui);

    expect(screen.queryByText(/BACKEND FOLLOW-UPS/)).not.toBeInTheDocument();
    expect(screen.queryByText(/in this PR/)).not.toBeInTheDocument();
    expect(screen.queryByText(/does not yet expose a list endpoint/)).not.toBeInTheDocument();
  });
});
