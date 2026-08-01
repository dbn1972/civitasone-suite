import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CtcCalculatorForm } from "./CtcCalculatorForm";

describe("CtcCalculatorForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("validates the CTC amount before calling the API", () => {
    render(<CtcCalculatorForm />);
    fireEvent.click(screen.getByText("Calculate Breakup"));
    expect(screen.getByText("Enter a valid annual CTC amount in rupees.")).toBeInTheDocument();
  });

  it("shows the computed breakup on success (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ctcMinor: 120000000,
          grossMinor: 100000000,
          employerCostMinor: 20000000,
          components: [
            { code: "BASIC", name: "Basic Salary", amountMinor: 48000000, isEmployerCost: false },
            { code: "ER_PF", name: "Employer PF", amountMinor: 5760000, isEmployerCost: true },
          ],
        }),
        { status: 200 },
      ),
    );

    render(<CtcCalculatorForm />);
    fireEvent.change(screen.getByLabelText("Annual CTC (₹)"), { target: { value: "1200000" } });
    fireEvent.click(screen.getByText("Calculate Breakup"));

    await waitFor(() => {
      expect(screen.getByText("Gross Pay")).toBeInTheDocument();
      expect(screen.getByText("Basic Salary")).toBeInTheDocument();
    });
  });

  it("surfaces a server error (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 400 }));

    render(<CtcCalculatorForm />);
    fireEvent.change(screen.getByLabelText("Annual CTC (₹)"), { target: { value: "1200000" } });
    fireEvent.click(screen.getByText("Calculate Breakup"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 400/)).toBeInTheDocument();
    });
  });
});
