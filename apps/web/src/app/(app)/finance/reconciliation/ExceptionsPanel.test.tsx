import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { ExceptionsPanel, type ExceptionRow } from "./ExceptionsPanel";

const OPEN_EXCEPTION: ExceptionRow = {
  id: "22222222-2222-2222-2222-222222222222",
  runId: "11111111-1111-1111-1111-111111111111",
  provider: "book-vs-bank",
  breakKey: "UTR12345",
  breakType: "value_mismatch",
  field: "amountMinor",
  fieldType: "amount",
  sourceValue: "100000",
  targetValue: "99000",
  deltaMinor: "-1000",
  severity: "high",
  status: "open",
  resolutionNote: null,
  resolvedBy: null,
  resolvedAt: null,
  createdAt: "2026-07-01T00:00:00.000Z",
};

const RESOLVED_EXCEPTION: ExceptionRow = {
  ...OPEN_EXCEPTION,
  id: "33333333-3333-3333-3333-333333333333",
  breakKey: "UTR99999",
  status: "resolved",
};

describe("ExceptionsPanel", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("renders the list of exceptions", () => {
    render(<ExceptionsPanel exceptions={[OPEN_EXCEPTION]} />);
    expect(screen.getByText("UTR12345")).toBeInTheDocument();
    expect(screen.getByLabelText("Investigate exception UTR12345")).toBeInTheDocument();
    expect(screen.getByLabelText("Resolve exception UTR12345")).toBeInTheDocument();
    expect(screen.getByLabelText("Write off exception UTR12345")).toBeInTheDocument();
  });

  it("renders an empty state when there are no exceptions", () => {
    render(<ExceptionsPanel exceptions={[]} />);
    expect(screen.getByText("No exceptions")).toBeInTheDocument();
  });

  it("offers only reopen for a resolved exception, with a distinct label", () => {
    render(<ExceptionsPanel exceptions={[OPEN_EXCEPTION, RESOLVED_EXCEPTION]} />);
    expect(screen.getByLabelText("Reopen exception UTR99999")).toBeInTheDocument();
    expect(screen.queryByLabelText("Resolve exception UTR99999")).not.toBeInTheDocument();
  });

  it("resolves an exception on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { ...OPEN_EXCEPTION, status: "resolved" } }), { status: 200 }),
    );

    render(<ExceptionsPanel exceptions={[OPEN_EXCEPTION]} />);
    fireEvent.click(screen.getByLabelText("Resolve exception UTR12345"));

    await waitFor(() => expect(screen.getByText("Resolve this exception?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Matched manually to bank UTR12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));

    await waitFor(() => {
      expect(screen.getByText(/marked "Resolve"/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  // UX-016: this used to assert the raw backend `code`/`message`
  // ("INVALID_TRANSITION: cannot resolve an exception in status resolved")
  // was echoed verbatim on the confirm dialog -- the same class of leak
  // useFormError/toHumanError closes fleet-wide (UX-003). The clerk-safe
  // replacement never shows backend-authored text or the status code, so
  // this now asserts a catalogued message instead, and explicitly that the
  // raw text is absent.
  it("shows a clerk-safe error on a failed action (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "INVALID_TRANSITION", message: "cannot resolve an exception in status resolved" }), {
        status: 409,
      }),
    );

    render(<ExceptionsPanel exceptions={[OPEN_EXCEPTION]} />);
    fireEvent.click(screen.getByLabelText("Resolve exception UTR12345"));

    await waitFor(() => expect(screen.getByText("Resolve this exception?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Matched manually to bank UTR12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/This reconciliation exception was changed by someone else\. Refresh to see the latest version, then try again\./));
    expect(alert.textContent).not.toMatch(/INVALID_TRANSITION/);
    expect(alert.textContent).not.toMatch(/cannot resolve an exception/);
  });

  // GAP-FINANCE-RECONCILIATION-02: the officer must see the money at stake in the dialog.
  it("shows source value, target value and delta in the write-off confirmation", () => {
    render(<ExceptionsPanel exceptions={[{ ...OPEN_EXCEPTION, deltaMinor: "4500000", sourceValue: "9000000", targetValue: "4500000" }]} />);
    fireEvent.click(screen.getByLabelText("Write off exception UTR12345"));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Delta")).toBeInTheDocument();
    expect(within(dialog).getAllByText("₹45,000.00").length).toBeGreaterThanOrEqual(2); // delta + writing-off line (and target)
    expect(within(dialog).getByText("₹90,000.00")).toBeInTheDocument();
    expect(dialog.textContent).toMatch(/You are writing off\s*₹45,000\.00/);
  });

  it("shows raw source/target values for non-amount breaks", () => {
    render(<ExceptionsPanel exceptions={[{ ...OPEN_EXCEPTION, field: "status", fieldType: "string", sourceValue: "settled", targetValue: "pending", deltaMinor: null }]} />);
    fireEvent.click(screen.getByLabelText("Resolve exception UTR12345"));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("settled")).toBeInTheDocument();
    expect(within(dialog).getByText("pending")).toBeInTheDocument();
  });

  // GAP-FINANCE-RECONCILIATION-01 / DETAIL-01: a justification is mandatory and is sent as `note`.
  it("blocks Write off until a reason of minimum length is given, and sends it as note", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({}), { status: 202 }));
    render(<ExceptionsPanel exceptions={[OPEN_EXCEPTION]} />);
    fireEvent.click(screen.getByLabelText("Write off exception UTR12345"));
    const dialog = screen.getByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Write off" });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "too short" } });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Bank charge, approved by CFO memo 12" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ action: "write_off", note: "Bank charge, approved by CFO memo 12" });
  });

  it("does not require a note for investigate, but still sends one when typed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({}), { status: 202 }));
    render(<ExceptionsPanel exceptions={[OPEN_EXCEPTION]} />);
    fireEvent.click(screen.getByLabelText("Investigate exception UTR12345"));
    const dialog = screen.getByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Investigate" });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ action: "investigate" });
  });

  it("shows the resolution note and date on a resolved row", () => {
    render(
      <ExceptionsPanel
        exceptions={[
          {
            ...RESOLVED_EXCEPTION,
            resolutionNote: "Matched to UTR on bank statement",
            resolvedBy: "11111111-aaaa-4000-8000-000000000001",
            resolvedAt: "2026-07-02T00:00:00.000Z",
          },
        ]}
      />,
    );
    expect(screen.getByText("Matched to UTR on bank statement")).toBeInTheDocument();
    expect(screen.getByText(/02\/07\/2026|02 Jul 2026/)).toBeInTheDocument();
    // a raw actor UUID is never shown as a name
    expect(screen.queryByText(/11111111-aaaa/)).not.toBeInTheDocument();
  });

  // GAP-FINANCE-RECONCILIATION-03 / DETAIL-05
  it("renders read-only with no action buttons when canAct is false", () => {
    render(<ExceptionsPanel exceptions={[OPEN_EXCEPTION, RESOLVED_EXCEPTION]} canAct={false} />);
    expect(screen.getByText("UTR12345")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Write off exception/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Reopen exception/)).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/read-only access/);
  });

  // GAP-FINANCE-RECONCILIATION-04: an open break is red, not green.
  it("tones status pills: open red, investigating amber, resolved green, written off neutral", () => {
    const rows: ExceptionRow[] = [
      OPEN_EXCEPTION,
      { ...OPEN_EXCEPTION, id: "a", breakKey: "K-INV", status: "investigating" },
      RESOLVED_EXCEPTION,
      { ...OPEN_EXCEPTION, id: "b", breakKey: "K-WO", status: "written_off" },
    ];
    render(<ExceptionsPanel exceptions={rows} />);
    expect(screen.getByText("Open").className).toContain("bad");
    expect(screen.getByText("Investigating").className).toContain("warn");
    expect(screen.getByText("Resolved").className).toContain("good");
    expect(screen.getByText("Written Off").className).toContain("mut");
  });

  // GAP-FINANCE-RECONCILIATION-05: Actions lead the row so they stay reachable on a phone.
  it("puts the Actions column first and folds provider/type under the break key", () => {
    const { container } = render(<ExceptionsPanel exceptions={[OPEN_EXCEPTION]} />);
    const headers = Array.from(container.querySelectorAll("thead th")).map((h) => h.textContent);
    expect(headers[0]).toBe("Actions");
    expect(headers).not.toContain("Provider");
    expect(screen.getByText(/book-vs-bank · value_mismatch/)).toBeInTheDocument();
  });
});
