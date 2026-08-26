import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
let searchParamsMock = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParamsMock,
}));

vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  }),
}));

import RecordProgressPage from "./page";

// The REAL rows returned by GET /v1/works/execution/:workId/scopes — a raw
// select from work_scopes (works-service execution/repo.ts listScopes,
// schema.ts). There is NO scopeName / targetQuantity / unit column; the label
// must come from `description` (optional), the target from `targetValue`, and
// the submitted value is the work_scope `id`.
const SCOPE_A = {
  id: "ws-aaaa-1111",
  tenantId: "t-1",
  workId: "work-123",
  scopeId: "aaaaaaaa-1111-2222-3333-444444444444",
  targetValue: "100",
  description: "Earthwork in excavation",
  plannedStart: null,
  plannedEnd: null,
  version: 1,
};
const SCOPE_B = {
  id: "ws-bbbb-2222",
  tenantId: "t-1",
  workId: "work-123",
  scopeId: "bbbbbbbb-5555-6666-7777-888888888888",
  targetValue: "50",
  description: null, // optional — must still render a distinguishable label
  plannedStart: null,
  plannedEnd: null,
  version: 1,
};

describe("RecordProgressPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    searchParamsMock = new URLSearchParams();
  });

  it("describes progress as a per-period increment added to the running total, not a cumulative replacement", () => {
    render(<RecordProgressPage />);
    expect(screen.getByLabelText(/Progress this period/i)).toBeInTheDocument();
    expect(screen.getByText(/added to the running cumulative total/i)).toBeInTheDocument();
    // The previous, incorrect instruction ("enter the cumulative ... not the
    // period increment") must be gone — following it double-counted progress.
    expect(
      screen.queryByText(/cumulative achievement to date, not the period increment/i),
    ).toBeNull();
  });

  it("builds a scope dropdown with distinguishable, real labels from the ?workId scopes response", async () => {
    searchParamsMock = new URLSearchParams("workId=work-123");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).endsWith("/scopes")) {
        return new Response(JSON.stringify({ data: [SCOPE_A, SCOPE_B] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: { id: "prog-1" } }), { status: 202 });
    });

    render(<RecordProgressPage />);

    // Consumes the workId param to fetch that work's scopes.
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/proxy/v1/works/execution/work-123/scopes",
        expect.anything(),
      ),
    );

    // Scope with a description shows it plus its target value.
    const optA = (await screen.findByRole("option", {
      name: /Earthwork in excavation — target 100/i,
    })) as HTMLOptionElement;
    // Scope WITHOUT a description falls back to a scopeId-derived label — NOT
    // the fabricated literal "Scope" that the old fictional-shape mapping used.
    const optB = screen.getByRole("option", { name: /Scope bbbbbbbb/i }) as HTMLOptionElement;

    // The two options are genuinely distinguishable (the reported bug rendered
    // every option as the identical string "Scope").
    expect(optA.textContent).not.toBe(optB.textContent);
    expect(screen.queryByRole("option", { name: "Scope" })).toBeNull();

    // The submitted value is the work_scope id (unchanged contract).
    expect(optA.value).toBe("ws-aaaa-1111");
    expect(optB.value).toBe("ws-bbbb-2222");

    // Selecting a scope and submitting posts that id as workScopeId.
    fireEvent.change(screen.getByLabelText(/Work Scope/i), { target: { value: "ws-aaaa-1111" } });
    fireEvent.change(screen.getByLabelText(/Progress this period/i), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Progress" }));

    await waitFor(() => {
      const post = fetchSpy.mock.calls.find(([u]) => String(u).endsWith("/execution/progress"));
      expect(post).toBeTruthy();
      const body = JSON.parse((post![1] as RequestInit).body as string);
      expect(body.workScopeId).toBe("ws-aaaa-1111");
      expect(body.currentAchievement).toBe(20);
    });
  });

  it("falls back to manual scope-id entry when the work has no scopes", async () => {
    searchParamsMock = new URLSearchParams("workId=work-123");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );

    render(<RecordProgressPage />);

    await waitFor(() =>
      expect(
        screen.getByPlaceholderText(/123e4567-e89b-12d3-a456-426614174000/),
      ).toBeInTheDocument(),
    );
  });
});
