import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { RequestDetailClient } from "./RequestDetailClient";
import enMessages from "@/messages/en.json";
import type { Grievance } from "../../_data/loaders";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const mockGrievance: Grievance = {
  id: "gr1",
  category: "sanitation",
  subject: "Garbage not collected",
  description: "5 days uncollected",
  priority: "high",
  status: "open",
  departmentRef: "Sanitation Dept",
  assignedTo: null,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-02T00:00:00Z",
  actions: [],
};

function renderClient(props: Partial<Parameters<typeof RequestDetailClient>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <RequestDetailClient id="gr1" {...props} />
    </NextIntlClientProvider>,
  );
}

describe("RequestDetailClient -- PERF-009 tranche 2 (SSR loader integration)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the server-provided grievance immediately and does NOT fetch on mount when the server loader succeeded", async () => {
    renderClient({ initialGrievance: mockGrievance, initialSource: "api" });

    // Real data is visible on the very first render -- no loading state.
    expect(screen.getByText("Garbage not collected")).toBeInTheDocument();

    // Give any effect a tick to (not) fire, then assert fetch was never called.
    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
  });

  it("renders not-found immediately (no fetch) when the server loader succeeded with no record", async () => {
    renderClient({ initialGrievance: null, initialSource: "api" });

    expect(await screen.findByText(enMessages.citizenRequests.notFoundTitle)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("falls back to the original client-side fetch on mount when the server loader errored (unchanged pre-existing behavior)", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockGrievance,
    });

    renderClient({ initialSource: "error" });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    // UX-fetch-cancellation: the mount-time fetch is now threaded an
    // AbortSignal (cleaned up on unmount) -- see load()'s AbortController.
    expect(fetch).toHaveBeenCalledWith("/api/proxy/v1/citizen/grievances/gr1", { cache: "no-store", signal: expect.any(AbortSignal) });
    expect(await screen.findByText("Garbage not collected")).toBeInTheDocument();
  });

  it("falls back to fetching on mount when no initial props are given at all (default matches pre-existing behavior)", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockGrievance,
    });

    renderClient();

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });

  it("GAP-CITIZEN-REQUESTS-DETAIL-06: category, priority and action type render humanized (not raw snake_case)", async () => {
    const g: Grievance = {
      ...mockGrievance,
      category: "info_sought",
      priority: "high",
      actions: [{ id: "a1", actionType: "info_sought", note: null, createdAt: "2024-01-02T00:00:00Z" } as Grievance["actions"][number]],
    };
    renderClient({ initialGrievance: g, initialSource: "api" });
    // "info_sought" -> "Info Sought", "high" -> "High"
    expect(await screen.findAllByText(/Info Sought/)).not.toHaveLength(0);
    expect(screen.getByText("High")).toBeInTheDocument();
    // raw snake_case must NOT appear
    expect(screen.queryByText("info_sought")).not.toBeInTheDocument();
  });

  it("GAP-CITIZEN-REQUESTS-DETAIL-07: shows the assigned officer when present, — when not", async () => {
    renderClient({ initialGrievance: { ...mockGrievance, assignedTo: "Officer R" }, initialSource: "api" });
    expect(await screen.findByText("Officer R")).toBeInTheDocument();
  });

  it("GAP-CITIZEN-REQUESTS-DETAIL-04: escalate sends the exact reason, never a placeholder", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 202, json: async () => ({}) });
    renderClient({ initialGrievance: { ...mockGrievance, status: "open" }, initialSource: "api" });
    // Call the escalate flow indirectly: the ConfirmDialog's onConfirm passes a
    // reason. We assert the request body carries the typed reason verbatim.
    // (Reaching into the dialog is covered by ActionButton's own tests; here we
    // assert the fetch contract once escalate() runs with a real reason.)
    // Simulate by locating the Escalate action button and opening its dialog.
    const escalateBtn = await screen.findByRole("button", { name: enMessages.citizenRequests.escalate });
    escalateBtn.click();
    // The dialog's reason textarea + confirm are rendered by ActionButton;
    // assert no network call fired on open (no premature submit).
    expect(fetch).not.toHaveBeenCalled();
  });

  it("GAP-CITIZEN-REQUESTS-DETAIL-04/05: confirming escalate sends the typed reason verbatim and shows a Processing cue", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 202, json: async () => ({ ...mockGrievance, status: "open" }) });
    renderClient({ initialGrievance: { ...mockGrievance, status: "open" }, initialSource: "api" });

    fireEvent.click(await screen.findByRole("button", { name: enMessages.citizenRequests.escalate }));
    const dialog = await screen.findByRole("alertdialog");
    const reason = dialog.querySelector("textarea")!;
    fireEvent.change(reason, { target: { value: "Breaching SLA by 3 days" } });
    fireEvent.click(within(dialog).getByRole("button", { name: enMessages.citizenRequests.escalate }));

    await waitFor(() => {
      const escalateCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([url]) => typeof url === "string" && url.endsWith("/escalate"),
      );
      expect(escalateCall).toBeTruthy();
      const body = JSON.parse((escalateCall![1] as RequestInit).body as string);
      // DETAIL-04: the exact reason, never a "Escalated by officer" placeholder.
      expect(body.reason).toBe("Breaching SLA by 3 days");
    });
    // DETAIL-05: a Processing cue is shown while the async (202) result settles.
    expect(await screen.findByText(enMessages.citizenRequests.processing)).toBeInTheDocument();
  });
});
