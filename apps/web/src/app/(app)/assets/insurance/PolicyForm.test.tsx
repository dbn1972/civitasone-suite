import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { PolicyForm } from "./PolicyForm";
import type { AssetOption } from "./page";

const assets: AssetOption[] = [{ id: "a1", code: "AST-001", name: "Server Rack" }];

describe("PolicyForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires all fields before submitting and focuses the first invalid field", () => {
    render(<PolicyForm assets={assets} />);
    fireEvent.click(screen.getByRole("button", { name: "Create insurance policy" }));

    expect(screen.getByText("Select the asset this policy covers.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Asset/)).toHaveFocus();
  });

  it("creates a policy on submit (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "policy-1", status: "accepted", correlationId: "c1" }), { status: 202 }),
    );

    render(<PolicyForm assets={assets} />);
    fireEvent.change(screen.getByLabelText(/^Asset/), { target: { value: "a1" } });
    fireEvent.change(screen.getByLabelText(/^Policy Number/), { target: { value: "POL-2026-001" } });
    fireEvent.change(screen.getByLabelText(/^Insurer/), { target: { value: "National Insurance Co" } });
    fireEvent.change(screen.getByLabelText(/^Sum Insured/), { target: { value: "500000" } });
    fireEvent.change(screen.getByLabelText(/^Premium/), { target: { value: "12500" } });
    fireEvent.change(screen.getByLabelText(/^Start Date/), { target: { value: "2026-04-01" } });
    fireEvent.change(screen.getByLabelText(/^End Date/), { target: { value: "2027-03-31" } });

    fireEvent.click(screen.getByRole("button", { name: "Create insurance policy" }));

    await waitFor(() => {
      expect(screen.getByText(/Policy submitted/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();

    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    // Money guard: rupees input must be converted via rupeesToMinorString, never raw *100.
    expect(body.coverageMinor).toBe(50000000);
    expect(body.premiumMinor).toBe(1250000);
  });

  it("rejects an end date on/before the start date via the custom validator", () => {
    render(<PolicyForm assets={assets} />);
    fireEvent.change(screen.getByLabelText(/^Asset/), { target: { value: "a1" } });
    fireEvent.change(screen.getByLabelText(/^Policy Number/), { target: { value: "POL-2026-001" } });
    fireEvent.change(screen.getByLabelText(/^Insurer/), { target: { value: "National Insurance Co" } });
    fireEvent.change(screen.getByLabelText(/^Sum Insured/), { target: { value: "500000" } });
    fireEvent.change(screen.getByLabelText(/^Premium/), { target: { value: "12500" } });
    fireEvent.change(screen.getByLabelText(/^Start Date/), { target: { value: "2026-04-01" } });
    fireEvent.change(screen.getByLabelText(/^End Date/), { target: { value: "2026-04-01" } });

    fireEvent.click(screen.getByRole("button", { name: "Create insurance policy" }));

    expect(screen.getByText("End date must be after the start date.")).toBeInTheDocument();
  });

  it("surfaces a server error on submit (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<PolicyForm assets={assets} />);
    fireEvent.change(screen.getByLabelText(/^Asset/), { target: { value: "a1" } });
    fireEvent.change(screen.getByLabelText(/^Policy Number/), { target: { value: "POL-2026-001" } });
    fireEvent.change(screen.getByLabelText(/^Insurer/), { target: { value: "National Insurance Co" } });
    fireEvent.change(screen.getByLabelText(/^Sum Insured/), { target: { value: "500000" } });
    fireEvent.change(screen.getByLabelText(/^Premium/), { target: { value: "12500" } });
    fireEvent.change(screen.getByLabelText(/^Start Date/), { target: { value: "2026-04-01" } });
    fireEvent.change(screen.getByLabelText(/^End Date/), { target: { value: "2027-03-31" } });

    fireEvent.click(screen.getByRole("button", { name: "Create insurance policy" }));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
  });
});
