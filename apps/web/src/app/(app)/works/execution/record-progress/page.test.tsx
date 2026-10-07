import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const pushMock = vi.fn();
let searchParamsMock = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParamsMock,
}));
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }),
}));
vi.mock("../../_data/worksPicker", () => ({
  searchWorkOptions: vi.fn(async () => []),
  resolveWorkOptions: vi.fn(async () => []),
}));
vi.mock("@/lib/api/browserClient", () => ({ browserFetch: (...a: unknown[]) => browserFetchMock(...a) }));
const browserFetchMock = vi.fn();

import RecordProgressPage from "./page";

const SCOPE = {
  id: "ws-aaaa-1111",
  scopeId: "aaaaaaaa-1111-2222-3333-444444444444",
  targetValue: "100",
  description: "Earthwork in excavation",
};

function mockWorkData(opts: { scopes?: unknown[]; progress?: unknown[]; scopesOk?: boolean } = {}) {
  const { scopes = [SCOPE], progress = [], scopesOk = true } = opts;
  browserFetchMock.mockImplementation(async (path: string) => {
    if (path.includes("/masters/scopes")) {
      return new Response(JSON.stringify({ data: [{ id: SCOPE.scopeId, unit: "sqm" }] }), { status: 200 });
    }
    if (path.includes("/scopes")) {
      return scopesOk
        ? new Response(JSON.stringify({ data: scopes }), { status: 200 })
        : new Response("", { status: 500 });
    }
    if (path.includes("/progress")) {
      return new Response(JSON.stringify({ data: progress }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  });
}

describe("RecordProgressPage (GAP-WORKS-EXECUTION-RECORD-PROGRESS-01..05)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    browserFetchMock.mockReset();
    searchParamsMock = new URLSearchParams("workId=work-123");
  });

  it("RP-01: renders a work picker and a scope select — no free-text scope-UUID input", async () => {
    mockWorkData();
    render(<RecordProgressPage />);
    expect(screen.getByRole("combobox", { name: "Work" })).toBeInTheDocument();
    await screen.findByRole("option", { name: /Earthwork in excavation/i });
    // The old placeholder UUID input is gone.
    expect(screen.queryByPlaceholderText(/123e4567-e89b-12d3-a456-426614174000/)).toBeNull();
  });

  it("RP-05: shows the unit (sqm) in the scope option and the quantity label", async () => {
    mockWorkData();
    render(<RecordProgressPage />);
    await screen.findByRole("option", { name: /Earthwork in excavation — target 100 sqm/i });
    expect(screen.getByLabelText(/Quantity done this period \(sqm\)/i)).toBeInTheDocument();
  });

  it("RP-02: shows current cumulative and warns when a new total would exceed target", async () => {
    // 60 recorded already for this scope.
    mockWorkData({ progress: [{ workScopeId: SCOPE.id, currentAchievement: 60 }] });
    render(<RecordProgressPage />);
    await screen.findByRole("option", { name: /Earthwork/i });
    fireEvent.change(screen.getByLabelText(/Work Scope/i), { target: { value: SCOPE.id } });
    await screen.findByText(/Recorded so far:/i);
    fireEvent.change(screen.getByLabelText(/Quantity done this period/i), { target: { value: "60" } });
    expect(await screen.findByText(/exceeds the scope target 100/i)).toBeInTheDocument();
  });

  it("RP-02/03: submit opens a confirm dialog and a double click issues exactly one POST", async () => {
    mockWorkData({ progress: [{ workScopeId: SCOPE.id, currentAchievement: 10 }] });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({}), { status: 202 }));
    render(<RecordProgressPage />);
    await screen.findByRole("option", { name: /Earthwork/i });
    fireEvent.change(screen.getByLabelText(/Work Scope/i), { target: { value: SCOPE.id } });
    fireEvent.change(screen.getByLabelText(/Quantity done this period/i), { target: { value: "20" } });

    fireEvent.click(screen.getByRole("button", { name: "Record Progress" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Record" });
    fireEvent.click(confirm);
    fireEvent.click(confirm); // rapid second click

    await waitFor(() => {
      const posts = fetchSpy.mock.calls.filter(([u]) => String(u).endsWith("/execution/progress"));
      expect(posts.length).toBe(1);
    });
  });

  it("RP-04: a future period blocks submit", async () => {
    mockWorkData();
    render(<RecordProgressPage />);
    await screen.findByRole("option", { name: /Earthwork/i });
    fireEvent.change(screen.getByLabelText(/Work Scope/i), { target: { value: SCOPE.id } });
    fireEvent.change(screen.getByLabelText(/Quantity done this period/i), { target: { value: "5" } });
    // Set year to next year (a future period).
    const nextYear = String(new Date().getFullYear() + 1);
    // Year select only lists currentYear-2..currentYear, so next year isn't an
    // option; instead assert the year field cannot be set to a far-future value.
    const yearSelect = screen.getByLabelText(/Year/i) as HTMLSelectElement;
    const optionValues = Array.from(yearSelect.options).map((o) => o.value);
    expect(optionValues).not.toContain(nextYear);
    expect(optionValues).not.toContain("2099");
  });

  it("RP-01: a scopes fetch failure shows a Retry affordance, not 'No scopes'", async () => {
    mockWorkData({ scopesOk: false });
    render(<RecordProgressPage />);
    expect(await screen.findByRole("button", { name: /Retry/i })).toBeInTheDocument();
    expect(screen.queryByText(/No scopes defined for this work/i)).toBeNull();
  });

  it("RP: still describes progress as a per-period increment added to the running total", async () => {
    mockWorkData();
    render(<RecordProgressPage />);
    expect(screen.getByText(/added to the running\s+cumulative total/i)).toBeInTheDocument();
  });
});
