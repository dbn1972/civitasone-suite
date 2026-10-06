import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { CapaRowAction } from "./CapaActions";

describe("CapaRowAction", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  // GAP-INSPECTION-CAPA-01: Complete now opens a confirm dialog requiring
  // closure remarks; those remarks become the evidenceOfClosure note (the
  // hard-coded {source:"inspection-hub"} stub is gone). A bare click fires no
  // request; an empty remark cannot be submitted.
  it("Complete requires typed closure remarks and sends them as evidenceOfClosure", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(<CapaRowAction id="capa-1" status="in_progress" />);
    fireEvent.click(screen.getByRole("button", { name: /complete/i }));
    expect(fetchSpy).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("alertdialog");
    const confirmBtn = within(dialog).getByRole("button", { name: /mark complete/i });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "Replaced faulty wiring and re-tested" },
    });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("/capa/capa-1/complete");
    const body = JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body));
    expect(body.evidenceOfClosure[0].note).toBe("Replaced faulty wiring and re-tested");
    expect(body.evidenceOfClosure[0].source).not.toBe("inspection-hub");
    expect(refreshMock).toHaveBeenCalled();
  });

  // GAP-INSPECTION-CAPA-02: Verify is a sign-off — it opens a confirm dialog
  // and fires no request until confirmed with remarks.
  it("Verify requires a confirm step before POSTing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(<CapaRowAction id="capa-2" status="completed" />);
    fireEvent.click(screen.getByRole("button", { name: /verify/i }));
    expect(fetchSpy).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Checked, effective" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /confirm verification/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("/capa/capa-2/verify");
  });

  it("shows Start (not Complete) for status=open, and POSTs /start with no Content-Type/body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(<CapaRowAction id="capa-open" status="open" />);
    expect(screen.queryByRole("button", { name: /complete/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    await waitFor(() => expect(screen.getByText(/status will update shortly/i)).toBeInTheDocument());
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("/capa/capa-open/start");
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string> | undefined)?.["Content-Type"]).toBeUndefined();
    expect(refreshMock).toHaveBeenCalled();
  });

  it("also shows Complete (not Start) for status=overdue — overdue can complete directly", async () => {
    render(<CapaRowAction id="capa-od" status="overdue" />);
    expect(screen.queryByRole("button", { name: /start/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /complete/i })).toBeInTheDocument();
  });

  // GAP-INSPECTION-CAPA-03: a failing start shows catalogued clerk-safe copy,
  // never the raw response text.
  it("shows a clerk-safe message when start fails, never the raw response text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom raw error", { status: 500 }));
    render(<CapaRowAction id="capa-x" status="open" />);
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText(/boom raw error/i)).not.toBeInTheDocument();
  });
});
