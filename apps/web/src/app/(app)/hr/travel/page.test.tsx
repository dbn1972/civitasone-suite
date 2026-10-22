import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
const getSessionRolesMock = vi.fn();
const getSessionUserIdMock = vi.fn(() => "actor-viewer" as string | null);
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => getSessionRolesMock(),
  getSessionUserId: () => getSessionUserIdMock(),
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

// Real payloads through the page's REAL mapResponse (fetchJson is otherwise mocked).
const SELF_ROWS = [
  { id: "s1", purpose: "Field inspection", destination: "Pune", from_date: "2026-10-01", to_date: "2026-10-03", advance_required: 250000, mode: "rail", status: "approved", created_at: "2026-09-20T00:00:00Z", approved_by: "m1", approved_at: "2026-09-21T00:00:00Z", rejection_reason: null },
  { id: "s2", purpose: "Audit visit", destination: "Nagpur", from_date: "2026-11-01", to_date: "2026-11-02", advance_required: null, mode: "air", status: "rejected", created_at: "2026-09-22T00:00:00Z", approved_by: "m1", approved_at: "2026-09-23T00:00:00Z", rejection_reason: "Budget exceeded" },
  { id: "s3", purpose: "Training", destination: "Indore", from_date: "2026-12-01", to_date: "2026-12-02", advance_required: 0, mode: "road", status: "pending", created_at: "2026-09-24T00:00:00Z", approved_by: null, approved_at: null, rejection_reason: null },
];
const TEAM_ROWS = [
  { id: "p1", employee_id: "actor-asha", employeeName: "Asha Verma", purpose: "Site survey", destination: "Raipur", from_date: "2026-10-10", to_date: "2026-10-11", advance_required: 100000, mode: "road", status: "pending", created_at: "2026-09-25T00:00:00Z", approved_by: null, approved_at: null, rejection_reason: null },
  // Defence in depth: even if the queue ever contained the viewer's own request, it must carry no actions.
  { id: "p2", employee_id: "actor-viewer", employeeName: "Viewer Self", purpose: "Own trip", destination: "Bhopal", from_date: "2026-10-12", to_date: "2026-10-13", advance_required: null, mode: "rail", status: "pending", created_at: "2026-09-26T00:00:00Z", approved_by: null, approved_at: null, rejection_reason: null },
];

function realLoaders() {
  fetchJsonMock.mockImplementation(async (url: string, _fallback: unknown, opts: { mapResponse: (p: unknown) => unknown }) => ({
    data: opts.mapResponse({ data: url.includes("scope=team") ? TEAM_ROWS : SELF_ROWS }),
    source: "api",
  }));
}

describe("TravelRequestsPage end to end through the real mappers (GAP-HR-TRAVEL-01/02/05)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReset();
    getSessionUserIdMock.mockReset();
    getSessionUserIdMock.mockReturnValue("actor-viewer");
  });

  it("GAP-HR-TRAVEL-02: the subtitle describes what exists and never promises LTC or TA/DA settlement", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    realLoaders();
    await renderPage();
    expect(enMessages.travel.subtitle).not.toMatch(/LTC|TA\/DA/i);
    expect(screen.getByText(enMessages.travel.subtitle)).toBeInTheDocument();
    expect(screen.getByText(/tour advances/i)).toBeInTheDocument();
  });

  it("GAP-HR-TRAVEL-02: the advance shows as INR, and only the approved row offers a claim link", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    realLoaders();
    await renderPage();
    const pune = screen.getByText("Pune").closest("tr") as HTMLElement;
    expect(pune.textContent).toMatch(/2,500\.00/);
    expect(within(pune).getByRole("link", { name: /claim expenses/i })).toHaveAttribute("href", "/hr/expenses?travelRequestId=s1");
    for (const dest of ["Nagpur", "Indore"]) {
      const tr = screen.getByText(dest).closest("tr") as HTMLElement;
      expect(within(tr).queryByRole("link", { name: /claim expenses/i })).toBeNull();
    }
  });

  it("GAP-HR-TRAVEL-01: the requester sees the rejection reason on a rejected request", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    realLoaders();
    await renderPage();
    const nagpur = screen.getByText("Nagpur").closest("tr") as HTMLElement;
    expect(within(nagpur).getByText("Budget exceeded")).toBeInTheDocument();
  });

  it("GAP-HR-TRAVEL-01: a requester (employee) gets no Approve / Reject at all", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    realLoaders();
    await renderPage();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
  });

  it("GAP-HR-TRAVEL-01: an approver sees actions on a team member's pending request but NEVER on their own", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    realLoaders();
    await renderPage();
    const asha = screen.getByText("Asha Verma").closest("tr") as HTMLElement;
    expect(within(asha).getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(within(asha).getByRole("button", { name: "Reject" })).toBeInTheDocument();
    const own = screen.getByText("Viewer Self").closest("tr") as HTMLElement;
    expect(within(own).queryByRole("button", { name: "Approve" })).toBeNull();
    expect(within(own).queryByRole("button", { name: "Reject" })).toBeNull();
    expect(within(own).getByText("Your own request")).toBeInTheDocument();
  });

  it("GAP-HR-TRAVEL-01: the empty copy differs per role", async () => {
    realLoaders();
    fetchJsonMock.mockImplementation(async () => ({ data: [], source: "api" }));
    getSessionRolesMock.mockReturnValue(["employee"]);
    const first = await renderPage();
    expect(screen.getByText(/reporting manager reviews each request/i)).toBeInTheDocument();
    first.unmount();

    getSessionRolesMock.mockReturnValue(["manager"]);
    await renderPage();
    expect(screen.getByText(/listed under Pending Approvals/i)).toBeInTheDocument();
  });
});
