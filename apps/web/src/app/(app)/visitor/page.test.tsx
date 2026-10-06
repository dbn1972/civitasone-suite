import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

// GAP-VISITOR-HOME-05: the page uses getTranslations("visitor.home"); map keys
// to the English copy so assertions read naturally.
const EN: Record<string, string> = {
  title: "Visitor Management",
  subtitle: "Gate operations, host approvals and premises policy — one place.",
  statAwaiting: "Awaiting Approval",
  statExpectedToday: "Expected Today",
  statUpcoming: "Approved — upcoming",
  countsError: "We could not load visitor counts.",
  countsErrorNext: "Some figures below show “—”. Try again.",
  guardTitle: "Guard Console",
  guardDesc: "Verify passes at the gate…",
  hostTitle: "Host Portal",
  hostDesc: "Approve or reject…",
  adminTitle: "Admin Configuration",
  adminDesc: "Tune visitor policy…",
  open: "Open",
};
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => EN[key] ?? key,
}));

let mockRoles: string[] = ["tenant_admin"];
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return {
    ...actual,
    getSessionRoles: () => mockRoles,
  };
});

const getVisitRequestsMock = vi.fn();
vi.mock("./_data/loaders", () => ({
  getVisitRequests: (...a: unknown[]) => getVisitRequestsMock(...a),
}));

import VisitorHomePage from "./page";
import type { VisitRequest } from "./_data/types";

function req(partial: Partial<VisitRequest>): VisitRequest {
  return {
    id: Math.random().toString(36).slice(2),
    status: "approved",
    purpose: null,
    scheduledAt: null,
    visitorName: "V",
    visitorPhone: "+910000000000",
    visitorEmail: null,
    hostEmployeeId: "h",
    locationId: "l",
    passType: "single",
    visitorCategory: "standard",
    permittedAreas: [],
    rejectionReason: null,
    trackingRef: null,
    createdAt: null,
    ...partial,
  };
}

describe("VisitorHomePage", () => {
  beforeEach(() => {
    getVisitRequestsMock.mockReset();
    mockRoles = ["tenant_admin"];
  });

  // GAP-VISITOR-HOME-02: a plain user without guard/admin roles must not see
  // the Guard Console or Admin Configuration tiles (they are role-gated).
  it("hides the guard and admin tiles for a user with no visitor roles", async () => {
    mockRoles = ["employee_without_visitor_access"];
    getVisitRequestsMock.mockResolvedValue({ data: [], source: "api" });
    render(await VisitorHomePage());
    expect(screen.getByText("Host Portal")).toBeInTheDocument();
    expect(screen.queryByText("Guard Console")).not.toBeInTheDocument();
    expect(screen.queryByText("Admin Configuration")).not.toBeInTheDocument();
  });

  it("shows all tiles for a tenant admin", async () => {
    mockRoles = ["tenant_admin"];
    getVisitRequestsMock.mockResolvedValue({ data: [], source: "api" });
    render(await VisitorHomePage());
    expect(screen.getByText("Guard Console")).toBeInTheDocument();
    expect(screen.getByText("Admin Configuration")).toBeInTheDocument();
    expect(screen.getByText("Host Portal")).toBeInTheDocument();
  });

  // GAP-VISITOR-HOME-01: a failed counts fetch must render "—" and a Retry
  // control, never a fabricated "0".
  it("shows '—' and a Retry control (not 0) when the counts fetch errors", async () => {
    getVisitRequestsMock.mockImplementation((status: string) =>
      Promise.resolve({ data: [], source: "error", status: status === "approved" ? 500 : 500 }),
    );
    render(await VisitorHomePage());

    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();

    const awaiting = screen.getByText("Awaiting Approval").parentElement!;
    expect(within(awaiting).getByText("—")).toBeInTheDocument();
    expect(within(awaiting).queryByText("0")).not.toBeInTheDocument();
  });

  // GAP-VISITOR-HOME-04: "Approved — upcoming" excludes approved visits dated
  // in the past, and the label matches the computation.
  it("counts only today-or-later approved visits as 'upcoming'", async () => {
    const now = Date.now();
    const yesterday = new Date(now - 48 * 3600 * 1000).toISOString();
    const tomorrow = new Date(now + 24 * 3600 * 1000).toISOString();
    getVisitRequestsMock.mockImplementation((status: string) => {
      if (status === "approved") {
        return Promise.resolve({
          data: [req({ scheduledAt: yesterday }), req({ scheduledAt: tomorrow })],
          source: "api",
        });
      }
      return Promise.resolve({ data: [], source: "api" });
    });
    render(await VisitorHomePage());

    const upcoming = screen.getByText("Approved — upcoming").parentElement!;
    // Only the 'tomorrow' request counts; the yesterday one is excluded.
    expect(within(upcoming).getByText("1")).toBeInTheDocument();
    expect(screen.queryByText("Approved (all)")).not.toBeInTheDocument();
  });

  it("shows no error banner and real counts when both loads succeed", async () => {
    getVisitRequestsMock.mockImplementation((status: string) =>
      Promise.resolve({ data: status === "pending_approval" ? [req({}), req({})] : [], source: "api" }),
    );
    render(await VisitorHomePage());
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
    const awaiting = screen.getByText("Awaiting Approval").parentElement!;
    expect(within(awaiting).getByText("2")).toBeInTheDocument();
  });
});
