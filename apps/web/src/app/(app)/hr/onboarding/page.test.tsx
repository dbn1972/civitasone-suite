import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import OnboardingPage from "./page";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "emp-1",
    employee: "Priya Sharma",
    department: "Finance",
    joiningDate: "2026-08-01",
    stepsCompleted: 3,
    totalSteps: 5,
    overdue: 0,
    progress: "60%",
    status: "in_progress",
    ...overrides,
  };
}

describe("OnboardingPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders a joinee card using the real /onboarding response field names", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [row({})], source: "api" });

    const ui = await OnboardingPage();
    render(ui);

    expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
    expect(screen.getByTestId("joinee-card-emp-1")).toBeInTheDocument();
  });

  it("shows the empty state when there are no onboarding records", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await OnboardingPage();
    render(ui);

    expect(screen.getByText("No joiners this month")).toBeInTheDocument();
  });

  it("shows the generic retry-suggesting error state when the fetch fails for a reason other than a permission denial", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "error" });

    const ui = await OnboardingPage();
    render(ui);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });

  // Manager-role finding: GET /v1/hrms/onboarding is HR-only (HR_ROLES in
  // onboarding-routes.ts) — a manager role gets a real, permanent 403, not a
  // transient failure. Before this fix the page couldn't tell the two apart
  // (both are source:"error") and showed the generic "Couldn't load, try
  // again" state for a request that will never succeed no matter how many
  // times it's retried.
  it("shows an honest access-restricted state, not the generic retry-suggesting error, when the fetch 403s", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "error", status: 403 });

    const ui = await OnboardingPage();
    render(ui);

    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(screen.getByText(/don.t have permission to view the onboarding tracker/i)).toBeInTheDocument();
    // Must NOT suggest retrying — retrying a real 403 never succeeds.
    expect(screen.queryByText("Couldn't load — showing nothing")).not.toBeInTheDocument();
    expect(screen.queryByText(/try again/i)).not.toBeInTheDocument();
    // None of the (meaningless-with-zero-access) stat tiles render.
    expect(screen.queryByText("No joiners this month")).not.toBeInTheDocument();
  });
});
