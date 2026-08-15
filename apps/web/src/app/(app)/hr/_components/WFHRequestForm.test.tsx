import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { WFHRequestForm } from "./WFHRequestForm";

describe("WFHRequestForm", () => {
  it("renders DoPT policy note", () => {
    render(<WFHRequestForm />);
    expect(screen.getByRole("note")).toBeInTheDocument();
    expect(screen.getByText(/2 days per week/i)).toBeInTheDocument();
  });

  it("renders From Date and To Date fields", () => {
    render(<WFHRequestForm />);
    expect(screen.getByLabelText(/from date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/to date/i)).toBeInTheDocument();
  });

  it("renders Reason textarea", () => {
    render(<WFHRequestForm />);
    expect(screen.getByLabelText(/reason/i)).toBeInTheDocument();
  });

  it("renders Submit and Cancel buttons", () => {
    render(<WFHRequestForm />);
    expect(screen.getByRole("button", { name: /submit request/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("shows employee UUID input when no prefill", () => {
    render(<WFHRequestForm />);
    expect(screen.getByLabelText(/employee id/i)).toBeInTheDocument();
  });

  it("hides employee UUID input when prefill provided", () => {
    render(<WFHRequestForm employeeId="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" />);
    expect(screen.queryByLabelText(/employee id/i)).not.toBeInTheDocument();
  });

  it("shows validation error when To date before From date", async () => {
    render(<WFHRequestForm />);
    fireEvent.change(screen.getByLabelText(/from date/i), { target: { value: "2026-08-20" } });
    fireEvent.change(screen.getByLabelText(/to date/i), { target: { value: "2026-08-15" } });
    fireEvent.click(screen.getByRole("button", { name: /submit request/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/cannot be before/i);
  });

  it("submit button is accessible with aria-busy when submitting", () => {
    render(<WFHRequestForm />);
    const btn = screen.getByRole("button", { name: /submit request/i });
    expect(btn).toHaveAttribute("aria-busy", "false");
  });
});
