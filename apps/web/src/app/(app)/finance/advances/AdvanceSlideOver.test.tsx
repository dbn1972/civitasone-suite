import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { AdvanceSlideOver } from "./AdvanceSlideOver";

describe("AdvanceSlideOver", () => {
  it("renders New Advance trigger button", () => {
    render(<AdvanceSlideOver />);
    expect(screen.getByRole("button", { name: /new advance/i })).toBeInTheDocument();
  });

  it("opens slide-over panel on button click", () => {
    render(<AdvanceSlideOver />);
    fireEvent.click(screen.getByRole("button", { name: /new advance/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("New Advance")).toBeInTheDocument();
  });

  it("shows GFR 2017 Rule 290 policy note in panel", () => {
    render(<AdvanceSlideOver />);
    fireEvent.click(screen.getByRole("button", { name: /new advance/i }));
    expect(screen.getByRole("note")).toBeInTheDocument();
    expect(screen.getByText(/GFR 2017 Rule 290/i)).toBeInTheDocument();
  });

  it("renders all required form fields including sanctioning authority", () => {
    render(<AdvanceSlideOver />);
    fireEvent.click(screen.getByRole("button", { name: /new advance/i }));
    expect(screen.getByLabelText(/advance type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/employee id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/repayment months/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/purpose/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/sanctioning authority/i)).toBeInTheDocument();
  });

  it("sanctioning authority field has aria-required and is required (GFR Rule 290)", () => {
    render(<AdvanceSlideOver />);
    fireEvent.click(screen.getByRole("button", { name: /new advance/i }));
    const field = screen.getByLabelText(/sanctioning authority/i);
    expect(field).toHaveAttribute("required");
    expect(field).toHaveAttribute("aria-required", "true");
  });

  it("blocks submission when sanctionedBy is empty — GFR Rule 290 required field", async () => {
    render(<AdvanceSlideOver />);
    fireEvent.click(screen.getByRole("button", { name: /new advance/i }));

    // Fill all fields except sanctionedBy
    fireEvent.change(screen.getByLabelText(/advance type/i), { target: { value: "TA" } });
    fireEvent.change(screen.getByLabelText(/employee id/i), { target: { value: "EMP00123" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "50000" } });
    fireEvent.change(screen.getByLabelText(/repayment months/i), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText(/purpose/i), { target: { value: "Festival advance for Diwali" } });
    // sanctionedBy intentionally left empty

    fireEvent.click(screen.getByRole("button", { name: /submit advance/i }));

    const alerts = await screen.findAllByRole("alert");
    const sanctionAlert = alerts.find((a) => /sanctioning authority/i.test(a.textContent ?? ""));
    expect(sanctionAlert).toBeTruthy();
  });

  it("shows all advance type options in dropdown", () => {
    render(<AdvanceSlideOver />);
    fireEvent.click(screen.getByRole("button", { name: /new advance/i }));
    const select = screen.getByLabelText(/advance type/i);
    expect(select).toBeInTheDocument();
    ["TA", "Medical", "Festival", "HBA"].forEach((t) => {
      expect(screen.getByRole("option", { name: t })).toBeInTheDocument();
    });
  });

  it("shows max 24 months hint", () => {
    render(<AdvanceSlideOver />);
    fireEvent.click(screen.getByRole("button", { name: /new advance/i }));
    expect(screen.getByText(/Max 24 months/i)).toBeInTheDocument();
  });

  it("closes panel on Cancel click", () => {
    render(<AdvanceSlideOver />);
    fireEvent.click(screen.getByRole("button", { name: /new advance/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes panel on close (X) button", () => {
    render(<AdvanceSlideOver />);
    fireEvent.click(screen.getByRole("button", { name: /new advance/i }));
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows validation error when submitting empty form", async () => {
    render(<AdvanceSlideOver />);
    fireEvent.click(screen.getByRole("button", { name: /new advance/i }));
    fireEvent.click(screen.getByRole("button", { name: /submit advance/i }));
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);
  });

  it("submit button has accessible touch target min height", () => {
    render(<AdvanceSlideOver />);
    fireEvent.click(screen.getByRole("button", { name: /new advance/i }));
    const submit = screen.getByRole("button", { name: /submit advance/i });
    expect(submit).toHaveStyle({ minHeight: "44px" });
  });

  // UX-016: the failed-response branch used to show `body.message ??
  // \`Failed (${res.status})\`` -- a raw HTTP status code leak (UX-003).
  // Proves the fix: a failed submit shows a clerk-safe catalogued message,
  // never the raw status.
  it("shows a clerk-safe message when submission fails, never the raw status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 500 }),
    );

    render(<AdvanceSlideOver />);
    fireEvent.click(screen.getByRole("button", { name: /new advance/i }));

    fireEvent.change(screen.getByLabelText(/advance type/i), { target: { value: "TA" } });
    fireEvent.change(screen.getByLabelText(/employee id/i), { target: { value: "EMP00123" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "50000" } });
    fireEvent.change(screen.getByLabelText(/repayment months/i), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText(/purpose/i), { target: { value: "Festival advance for Diwali" } });
    fireEvent.change(screen.getByLabelText(/sanctioning authority/i), { target: { value: "Joint Secretary" } });

    fireEvent.click(screen.getByRole("button", { name: /submit advance/i }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
    expect(alert.textContent).not.toMatch(/failed \(/i);
  });
});
