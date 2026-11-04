import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
const roles = vi.hoisted(() => ({ list: ["finance_admin"] as string[] }));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => roles.list, getSessionUserId: () => "checker-1" }));

import PeriodCloseCockpitPage from "./page";

const render = (ui: React.ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

const HARD = { period: "2026-03", fiscalYear: "2025-26", status: "hard_close", closedBy: null, closedAt: null };
const REOPEN = {
  id: "11111111-1111-4111-8111-111111111111", kind: "period_reopen", subjectKey: "period:2026-03", payload: { period: "2026-03" },
  reason: "Correcting a posting error", status: "pending", requestedBy: "maker-1", requestedAt: "2026-04-10T10:00:00.000Z",
  decidedBy: null, decidedAt: null, decisionNote: null, version: 1,
};

function respond(requests: unknown) {
  fetchJsonMock.mockImplementation(async (url: string) => (String(url).includes("change-requests") ? requests : { data: [HARD], source: "api" }));
}

// fx-p3: pending reopen requests for hard-closed months are decided on the period-close page.
describe("PeriodCloseCockpitPage -- pending reopen requests (fx-p3)", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); roles.list = ["finance_admin"]; });

  it("a finance admin sees the pending period_reopen requests with the period named", async () => {
    respond({ data: [REOPEN], source: "api" });
    render(await PeriodCloseCockpitPage());
    expect(screen.getByText("Reopen requests awaiting a second officer")).toBeInTheDocument();
    expect(screen.getByText("Reopen accounting period: 2026-03")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    const call = fetchJsonMock.mock.calls.find(([u]) => String(u).includes("change-requests"))!;
    expect(String(call[0])).toContain("kind=period_reopen");
  });

  it("a failed read of the requests is an error state, not an empty list", async () => {
    respond({ data: [], source: "error", status: 503 });
    render(await PeriodCloseCockpitPage());
    expect(screen.queryByText("No changes are waiting for approval.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });

  it("a finance officer (no reopen right) is not shown the panel and it is not fetched", async () => {
    roles.list = ["finance_officer"];
    respond({ data: [REOPEN], source: "api" });
    render(await PeriodCloseCockpitPage());
    expect(screen.queryByText("Reopen requests awaiting a second officer")).not.toBeInTheDocument();
    expect(fetchJsonMock.mock.calls.some(([u]) => String(u).includes("change-requests"))).toBe(false);
  });
});
