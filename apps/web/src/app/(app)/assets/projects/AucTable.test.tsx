import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { AucTable, type AucRow } from "./AucTable";

const UNDER_CONSTRUCTION: AucRow = {
  id: "11111111-1111-1111-1111-111111111111",
  projectCode: "AUC-001",
  name: "New District Office Wing",
  wbsRef: "WBS-42",
  accumulatedMinor: 1500000,
  status: "under_construction",
  assetId: null,
};

describe("AucTable", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("renders the guided empty state with no rows", () => {
    render(<AucTable rows={[]} />);
    expect(screen.getByText("No AUC projects yet")).toBeInTheDocument();
  });

  it("capitalizes an AUC project on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "22222222-2222-2222-2222-222222222222" }), { status: 202 }),
    );

    render(<AucTable rows={[UNDER_CONSTRUCTION]} />);
    fireEvent.click(screen.getByRole("button", { name: "Capitalize project AUC-001" }));
    await waitFor(() => expect(screen.getByText('Capitalize "AUC-001"?')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Authorised by finance controller" } });
    fireEvent.click(screen.getByText("Capitalize to fixed asset"));

    await waitFor(() => {
      expect(screen.getByText(/Capitalization submitted for "AUC-001"/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces the server's error code/message on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "NOT_FOUND", message: "AUC not found" }), { status: 404 }),
    );

    render(<AucTable rows={[UNDER_CONSTRUCTION]} />);
    fireEvent.click(screen.getByRole("button", { name: "Capitalize project AUC-001" }));
    await waitFor(() => expect(screen.getByText('Capitalize "AUC-001"?')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Authorised by finance controller" } });
    fireEvent.click(screen.getByText("Capitalize to fixed asset"));

    await waitFor(() => {
      expect(screen.getByText(/NOT_FOUND: AUC not found/)).toBeInTheDocument();
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
