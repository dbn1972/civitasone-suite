import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
const getSessionRolesMock = vi.fn();
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => getSessionRolesMock(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import TravelRequestsPage from "./page";

async function renderPage() {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{await TravelRequestsPage()}</NextIntlClientProvider>);
}

describe("TravelRequestsPage approver team-queue states", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReset();
  });

  it("GAP2-HR-TRAVEL-07: a failed team-queue fetch renders an explicit error, not a hidden section", async () => {
    getSessionRolesMock.mockReturnValue(["manager"]);
    // first call: self list (ok); second call: team queue (error)
    fetchJsonMock
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValueOnce({ data: [], source: "error", status: 500 });
    await renderPage();
    // The approvals card title is still shown...
    expect(screen.getByText("Pending Approvals")).toBeInTheDocument();
    // ...and an error alert is present (RefreshErrorState) instead of a silent omission.
    const alerts = screen.getAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);
  });

  it("GAP2-HR-TRAVEL-08: the approvals card title comes from the i18n bundle", async () => {
    getSessionRolesMock.mockReturnValue(["manager"]);
    fetchJsonMock
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValueOnce({ data: [], source: "api" });
    await renderPage();
    // enMessages.travel.pendingApprovalsCardTitle === "Pending Approvals"
    expect(screen.getByText(enMessages.travel.pendingApprovalsCardTitle)).toBeInTheDocument();
  });

  it("a non-approver does not fetch or render the approvals section", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "api" });
    await renderPage();
    expect(screen.queryByText(enMessages.travel.pendingApprovalsCardTitle)).toBeNull();
    // only the self-list fetch happened
    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
  });
});
