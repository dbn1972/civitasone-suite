import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { InspectionRowAction } from "./InspectionActions";

describe("InspectionRowAction", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("POSTs transition and expects 202 Accepted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(<InspectionRowAction id="11111111-2222-4333-8444-555555555555" status="scheduled" />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByText(/accepted \(queued\)/i)).toBeInTheDocument());
    expect(fetchSpy.mock.calls[0]![0]).toContain("/inspections/11111111-2222-4333-8444-555555555555/transition");
    expect((fetchSpy.mock.calls[0]![1] as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body))).toEqual({
      targetState: "in_progress",
      remarks: "Started from inspection hub",
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  // Regression for a CRITICAL bug, confirmed live against the real service:
  // "Finalize" (under_review -> finalized) is the one action with no
  // action.body. The old run() set `Content-Type: application/json`
  // unconditionally regardless of body — that header survives the
  // /api/proxy catch-all verbatim (it forwards whatever content-type header
  // the browser sent, independent of whether a body existed) and reaches
  // Fastify's default JSON parser, which rejects an empty body under that
  // content-type with 400 FST_ERR_CTP_EMPTY_JSON_BODY. So the Finalize
  // button always failed in real use — a bug the backend's own
  // app.inject()-based integration test missed, because inject() doesn't
  // set a content-type header the way a real fetch() does when none is
  // passed. There was previously no frontend test for Finalize at all,
  // which is exactly how this shipped undetected on both sides.
  it("Finalize requires a real confirm step (irreversible — under_review -> finalized has no way back) and sends no Content-Type header", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(<InspectionRowAction id="11111111-2222-4333-8444-555555555555" status="under_review" />);
    fireEvent.click(screen.getByRole("button", { name: "Finalize" }));

    // A bare click must NOT fire the request — the confirm dialog gates it.
    expect(fetchSpy).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Finalize inspection" }));
    await waitFor(() => expect(screen.getByText(/accepted \(queued\)/i)).toBeInTheDocument());

    expect(fetchSpy.mock.calls[0]![0]).toContain("/inspections/11111111-2222-4333-8444-555555555555/finalize");
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string> | undefined)?.["Content-Type"]).toBeUndefined();
  });

  it("shows error when transition fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("invalid transition", { status: 422 }),
    );
    render(<InspectionRowAction id="11111111-2222-4333-8444-555555555555" status="scheduled" />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByText(/invalid transition|failed/i)).toBeInTheDocument());
  });
});
