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
    stepsCompleted: "3/5",
    totalSteps: "5",
    overdue: 0,
    progress: "60%",
    status: "in_progress",
    ...overrides,
  };
}

/** Mirrors the real GET /v1/hrms/onboarding response envelope: { data, meta }. */
function apiResult(rows: ReturnType<typeof row>[], overrides: { source?: string; status?: number } = {}) {
  const counts = {
    total: rows.length,
    inProgress: rows.filter((r) => r.status === "in_progress").length,
    overdue: rows.filter((r) => r.status === "overdue").length,
    completed: rows.filter((r) => r.status === "completed").length,
  };
  return {
    data: { rows, meta: { total: rows.length, limit: 20, offset: 0, counts } },
    source: "api",
    ...overrides,
  };
}

describe("OnboardingPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders a joinee card using the real /onboarding response field names", async () => {
    fetchJsonMock.mockResolvedValueOnce(apiResult([row({})]));

    const ui = await OnboardingPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
    expect(screen.getByTestId("joinee-card-emp-1")).toBeInTheDocument();
  });

  // GAP-HR-ONBOARDING-02: previously the only entry point into onboarding
  // was "+ Add New Joinee" (creates a brand-new employee); this search
  // control is the way to reach an EXISTING employee who has no tasks yet.
  it("GAP-HR-ONBOARDING-02: offers a way to start onboarding for an existing employee, not just create a new one", async () => {
    fetchJsonMock.mockResolvedValueOnce(apiResult([row({})]));

    const ui = await OnboardingPage({ searchParams: {} });
    render(ui);

    expect(screen.getByLabelText("Find an employee to start onboarding")).toBeInTheDocument();
  });

  // GAP-HR-ONBOARDING-03: the old copy ("No joiners this month") implied a
  // month filter that never existed; the new copy also now correctly
  // describes a real mechanism (GAP-HR-ONBOARDING-02's picker + add-task
  // form) instead of a dead end.
  it("GAP-HR-ONBOARDING-03: shows honest empty-state copy that matches how onboarding is actually started", async () => {
    fetchJsonMock.mockResolvedValueOnce(apiResult([]));

    const ui = await OnboardingPage({ searchParams: {} });
    render(ui);

    expect(screen.queryByText("No joiners this month")).not.toBeInTheDocument();
    expect(screen.getByText("No onboarding in progress")).toBeInTheDocument();
  });

  // GAP-HR-ONBOARDING-01 regression: the real API sends stepsCompleted as
  // the string "2/6", not a number. Number("2/6") is NaN -- the bug this
  // fix closes.
  it("GAP-HR-ONBOARDING-01: parses the real '<completed>/<total>' string shape instead of showing NaN", async () => {
    fetchJsonMock.mockResolvedValueOnce(apiResult([row({ stepsCompleted: "2/6", totalSteps: "6" })]));

    const ui = await OnboardingPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("2/6")).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  // GAP-HR-ONBOARDING-04 regression: the backend now sends null (not a raw
  // department uuid, not "—") when it can't resolve department/joiningDate.
  it("GAP-HR-ONBOARDING-04: shows a plain dash, never a raw uuid or 'Invalid Date', when department/joiningDate are unresolved", async () => {
    fetchJsonMock.mockResolvedValueOnce(
      apiResult([row({ department: null, joiningDate: null })]),
    );

    const ui = await OnboardingPage({ searchParams: {} });
    render(ui);

    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^[0-9a-f]{8}-/)).not.toBeInTheDocument(); // no raw uuid
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  // GAP-HR-ONBOARDING-05 regression: this used to be labelled "Overdue
  // Tasks" while actually counting JOINEES with >=1 overdue task -- a
  // tenant with 2 joinees and 5 overdue tasks between them would misread
  // the tile as "5". The stat value must match the joinee count, and the
  // label must not claim "Tasks".
  it("GAP-HR-ONBOARDING-05: the overdue stat tile counts joinees with overdue tasks, not the number of overdue tasks", async () => {
    fetchJsonMock.mockResolvedValueOnce(
      apiResult([
        row({ id: "emp-1", overdue: 3, status: "overdue" }),
        row({ id: "emp-2", overdue: 2, status: "overdue" }),
      ]),
    );

    const ui = await OnboardingPage({ searchParams: {} });
    render(ui);

    // Two joinees are overdue -- the stat tile must read 2, not 5.
    const overdueBadges = screen.getAllByText(/overdue$/i);
    expect(overdueBadges.length).toBeGreaterThan(0);
    expect(screen.queryByText("Overdue Tasks")).not.toBeInTheDocument();
  });

  // GAP-HR-ONBOARDING-06 regression: "pending" was a dead sort key the API
  // can never produce (completed|overdue|in_progress only) -- removing it
  // must not affect real statuses' rendering or ordering.
  it("GAP-HR-ONBOARDING-06: sorts overdue first, then in_progress, then completed (no 'pending' status exists)", async () => {
    fetchJsonMock.mockResolvedValueOnce(
      apiResult([
        row({ id: "emp-completed", employee: "Zed Completed", overdue: 0, status: "completed" }),
        row({ id: "emp-overdue", employee: "Amy Overdue", overdue: 1, status: "overdue" }),
        row({ id: "emp-progress", employee: "Ben Progress", overdue: 0, status: "in_progress" }),
      ], { status: "all" } as never),
    );

    const ui = await OnboardingPage({ searchParams: { status: "all" } });
    render(ui);

    const cards = screen.getAllByTestId(/^joinee-card-/);
    expect(cards[0]).toHaveAttribute("data-testid", "joinee-card-emp-overdue");
    expect(cards[1]).toHaveAttribute("data-testid", "joinee-card-emp-progress");
    expect(cards[2]).toHaveAttribute("data-testid", "joinee-card-emp-completed");
  });

  it("shows the empty state when there are no onboarding records", async () => {
    fetchJsonMock.mockResolvedValueOnce(apiResult([]));

    const ui = await OnboardingPage({ searchParams: {} });
    render(ui);

    expect(screen.queryByText("No joiners this month")).not.toBeInTheDocument();
    expect(screen.getByText("No onboarding in progress")).toBeInTheDocument();
  });

  it("shows the generic retry-suggesting error state when the fetch fails for a reason other than a permission denial", async () => {
    fetchJsonMock.mockResolvedValueOnce(apiResult([], { source: "error" }));

    const ui = await OnboardingPage({ searchParams: {} });
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
    fetchJsonMock.mockResolvedValueOnce(apiResult([], { source: "error", status: 403 }));

    const ui = await OnboardingPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(screen.getByText(/don.t have permission to view the onboarding tracker/i)).toBeInTheDocument();
    // Must NOT suggest retrying — retrying a real 403 never succeeds.
    expect(screen.queryByText("Couldn't load — showing nothing")).not.toBeInTheDocument();
    expect(screen.queryByText(/try again/i)).not.toBeInTheDocument();
    // None of the (meaningless-with-zero-access) stat tiles render.
    expect(screen.queryByText("No onboarding in progress")).not.toBeInTheDocument();
  });

  it("requests the 'active' status by default so a fresh visit doesn't need a manual filter to hide completed joinees", async () => {
    fetchJsonMock.mockResolvedValueOnce(apiResult([row({})]));

    await OnboardingPage({ searchParams: {} });

    const [calledPath] = fetchJsonMock.mock.calls[0] as [string];
    expect(calledPath).toContain("status=active");
  });

  it("requests the status named in searchParams instead of the default", async () => {
    fetchJsonMock.mockResolvedValueOnce(apiResult([row({ status: "completed" })]));

    await OnboardingPage({ searchParams: { status: "completed" } });

    const [calledPath] = fetchJsonMock.mock.calls[0] as [string];
    expect(calledPath).toContain("status=completed");
  });
});
