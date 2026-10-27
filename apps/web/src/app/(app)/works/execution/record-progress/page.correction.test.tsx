/**
 * Owner decision D4c #43: one progress entry per scope per month. A figure is fixed with a NEGATIVE entry and a reason,
 * so the form asks for the reason when the amount is negative, and explains a refused duplicate.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl as render } from "@/lib/testUtils/intl";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => new URLSearchParams("workId=work-123"),
}));
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }),
}));
vi.mock("../../_data/worksPicker", () => ({
  searchWorkOptions: vi.fn(async () => []),
  resolveWorkOptions: vi.fn(async () => []),
}));
const browserFetchMock = vi.fn();
vi.mock("@/lib/api/browserClient", () => ({ browserFetch: (...a: unknown[]) => browserFetchMock(...a) }));

import RecordProgressPage from "./page";

const SCOPE = { id: "ws-aaaa-1111", scopeId: "aaaaaaaa-1111-2222-3333-444444444444", targetValue: "100", description: "Earthwork" };
const NOW = new Date();

function mockWorkData(progress: unknown[] = []) {
  browserFetchMock.mockImplementation(async (path: string) => {
    if (path.includes("/masters/scopes")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
    if (path.includes("/scopes")) return new Response(JSON.stringify({ data: [SCOPE] }), { status: 200 });
    if (path.includes("/progress")) return new Response(JSON.stringify({ data: progress }), { status: 200 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  });
}
async function pickScope() {
  await screen.findByRole("option", { name: /Earthwork/i });
  fireEvent.change(screen.getByLabelText(/Work Scope/i), { target: { value: SCOPE.id } });
  await screen.findByText(/Recorded so far:/i);
}
const thisMonth = { month: NOW.getMonth() + 1, year: NOW.getFullYear() };

describe("RecordProgressPage: one entry per month, corrections are negative (D4c #43)", () => {
  beforeEach(() => { vi.restoreAllMocks(); pushMock.mockReset(); browserFetchMock.mockReset(); });

  it("asks for a reason only when the amount is negative", async () => {
    mockWorkData([{ workScopeId: SCOPE.id, currentAchievement: 20 }]);
    render(<RecordProgressPage />);
    await pickScope();
    expect(screen.queryByLabelText(/Reason for the correction/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Quantity done this period/i), { target: { value: "-5" } });
    expect(screen.getByLabelText(/Reason for the correction/i)).toBeInTheDocument();
  });

  it("blocks review of a negative amount until a reason is given", async () => {
    mockWorkData([{ workScopeId: SCOPE.id, currentAchievement: 20 }]);
    render(<RecordProgressPage />);
    await pickScope();
    fireEvent.change(screen.getByLabelText(/Quantity done this period/i), { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Progress" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/reason for the correction/i);
  });

  it("posts the correction with its reason", async () => {
    mockWorkData([{ workScopeId: SCOPE.id, currentAchievement: 20, ...thisMonth }]);
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<RecordProgressPage />);
    await pickScope();
    fireEvent.change(screen.getByLabelText(/Quantity done this period/i), { target: { value: "-5" } });
    fireEvent.change(screen.getByLabelText(/Reason for the correction/i), { target: { value: "Re-measured on site" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Progress" }));
    fireEvent.click(await screen.findByRole("button", { name: "Record" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const body = JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({ currentAchievement: -5, correctionReason: "Re-measured on site" });
  });

  it("a negative amount is not flagged as a duplicate of the month's entry", async () => {
    mockWorkData([{ workScopeId: SCOPE.id, currentAchievement: 20, ...thisMonth }]);
    render(<RecordProgressPage />);
    await pickScope();
    expect(await screen.findByTestId("duplicate-period-warning")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Quantity done this period/i), { target: { value: "-5" } });
    expect(screen.queryByTestId("duplicate-period-warning")).toBeNull();
  });

  it("an earlier correction does not make the month look taken", async () => {
    mockWorkData([{ workScopeId: SCOPE.id, currentAchievement: -2, entryKind: "correction", ...thisMonth }]);
    render(<RecordProgressPage />);
    await pickScope();
    expect(screen.queryByTestId("duplicate-period-warning")).toBeNull();
  });

  it("explains a refused duplicate (409) instead of a generic save error", async () => {
    mockWorkData([]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "DUPLICATE_PROGRESS_PERIOD", message: "raw server text" }), { status: 409, headers: { "content-type": "application/json" } }),
    );
    render(<RecordProgressPage />);
    await pickScope();
    fireEvent.change(screen.getByLabelText(/Quantity done this period/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Progress" }));
    fireEvent.click(await screen.findByRole("button", { name: "Record" }));
    await waitFor(() => expect(screen.getAllByText(/only one entry per month/i).length).toBeGreaterThan(0));
    expect(screen.queryByText(/raw server text/)).toBeNull();
  });
});
