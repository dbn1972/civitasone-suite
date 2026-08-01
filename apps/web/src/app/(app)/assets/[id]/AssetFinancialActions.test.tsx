import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { AssetFinancialActions } from "./AssetFinancialActions";

const PROPS = {
  assetId: "11111111-1111-1111-1111-111111111111",
  assetCode: "AST-0042",
  bookValueMinor: 1000000, // ₹10,000.00
};

describe("AssetFinancialActions — impairment", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("rejects an impairment loss greater than the current book value", () => {
    render(<AssetFinancialActions {...PROPS} />);
    fireEvent.change(screen.getByLabelText(/Impairment loss/), { target: { value: "50000" } });
    fireEvent.click(screen.getByRole("button", { name: "Record impairment" }));
    expect(screen.getByText(/cannot exceed the current book value/)).toBeInTheDocument();
    expect(screen.queryByText(`Record impairment on ${PROPS.assetCode}?`)).not.toBeInTheDocument();
  });

  it("rejects a future event date", () => {
    render(<AssetFinancialActions {...PROPS} />);
    fireEvent.change(screen.getByLabelText(/Impairment loss/), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText(/Event date/), { target: { value: "2099-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Record impairment" }));
    expect(screen.getByText("Event date cannot be in the future.")).toBeInTheDocument();
  });

  it("posts an impairment on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "evt-1" }), { status: 202 }),
    );

    render(<AssetFinancialActions {...PROPS} />);
    fireEvent.change(screen.getByLabelText(/Impairment loss/), { target: { value: "1500.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Record impairment" }));

    await waitFor(() => expect(screen.getByText(`Record impairment on ${PROPS.assetCode}?`)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Authorisation/), { target: { value: "Site inspection confirmed damage" } });
    fireEvent.click(screen.getByText("Post impairment"));

    await waitFor(() => {
      expect(screen.getByText(/Impairment of .* submitted for posting to the GL/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(call[0])).toContain(`v1/asset/assets/${PROPS.assetId}/impairment`);
    const body = JSON.parse((call[1] as RequestInit).body as string) as { amountMinor: number };
    expect(body.amountMinor).toBe(150050);
  });

  it("surfaces the server's error code/message on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "INVALID", message: "impairment exceeds book value" }), { status: 400 }),
    );

    render(<AssetFinancialActions {...PROPS} />);
    fireEvent.change(screen.getByLabelText(/Impairment loss/), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Record impairment" }));
    await waitFor(() => expect(screen.getByText(`Record impairment on ${PROPS.assetCode}?`)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Authorisation/), { target: { value: "reason" } });
    fireEvent.click(screen.getByText("Post impairment"));

    await waitFor(() => {
      expect(screen.getByText(/INVALID: impairment exceeds book value/)).toBeInTheDocument();
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

describe("AssetFinancialActions — revaluation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a new book value before opening the confirm dialog", () => {
    render(<AssetFinancialActions {...PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: "Record revaluation" }));
    expect(screen.getByText(/Enter the new book value/)).toBeInTheDocument();
  });

  it("posts an upward revaluation on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "evt-2" }), { status: 202 }),
    );

    render(<AssetFinancialActions {...PROPS} />);
    fireEvent.change(screen.getByLabelText(/New book value/), { target: { value: "12000" } });
    fireEvent.click(screen.getByRole("button", { name: "Record revaluation" }));

    await waitFor(() => expect(screen.getByText(`Record revaluation on ${PROPS.assetCode}?`)).toBeInTheDocument());
    expect(within(screen.getByRole("alertdialog")).getByText(/upward/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Authorisation/), { target: { value: "Independent valuer report" } });
    fireEvent.click(screen.getByText("Post revaluation"));

    await waitFor(() => {
      expect(screen.getByText(/Revaluation to .* submitted for posting to the GL/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string) as { newBookValueMinor: number };
    expect(body.newBookValueMinor).toBe(1200000);
  });

  it("shows a downward direction when the new value is below book value", async () => {
    render(<AssetFinancialActions {...PROPS} />);
    fireEvent.change(screen.getByLabelText(/New book value/), { target: { value: "8000" } });
    fireEvent.click(screen.getByRole("button", { name: "Record revaluation" }));
    await waitFor(() => expect(screen.getByText(`Record revaluation on ${PROPS.assetCode}?`)).toBeInTheDocument());
    expect(within(screen.getByRole("alertdialog")).getByText(/downward/)).toBeInTheDocument();
  });
});
