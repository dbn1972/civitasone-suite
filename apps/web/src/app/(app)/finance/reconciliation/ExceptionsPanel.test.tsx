import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));

    await waitFor(() => {
      expect(screen.getByText(/marked "Resolve"/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces the server error code on a failed action (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "INVALID_TRANSITION", message: "cannot resolve an exception in status resolved" }), {
        status: 409,
      }),
    );

    render(<ExceptionsPanel exceptions={[OPEN_EXCEPTION]} />);
    fireEvent.click(screen.getByLabelText("Resolve exception UTR12345"));

    await waitFor(() => expect(screen.getByText("Resolve this exception?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));

    await waitFor(() => {
      expect(screen.getByText(/INVALID_TRANSITION/)).toBeInTheDocument();
    });
  });
});
