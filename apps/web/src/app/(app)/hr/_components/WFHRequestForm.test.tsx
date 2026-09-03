import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { WFHRequestForm } from "./WFHRequestForm";

describe("WFHRequestForm", () => {
  it("renders DoPT policy note", () => {
    render(<WFHRequestForm />);
    const notes = screen.getAllByRole("note");
    expect(notes.length).toBeGreaterThanOrEqual(1);
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
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/from date/i), { target: { value: "2026-08-20" } });
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/to date/i), { target: { value: "2026-08-15" } });
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole("form", { name: /work from home request form/i }));
    });
    const alerts = screen.getAllByRole("alert");
    const dateErr = alerts.find(el => /cannot be before/i.test(el.textContent ?? ""));
    expect(dateErr).toBeTruthy();
  });

  it("submit button is accessible with aria-busy when submitting", () => {
    render(<WFHRequestForm />);
    const btn = screen.getByRole("button", { name: /submit request/i });
    expect(btn).toHaveAttribute("aria-busy", "false");
  });

  // DoPT OM 2022 eligibility gate tests

  it("disables submit and shows gazetted error for employee at Level > 10", () => {
    render(<WFHRequestForm payLevel={11} weeklyWfhCount={0} />);
    const banner = screen.getByTestId("gazetted-error");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent(/Level 1.10.*DoPT OM 2022/i);
    expect(screen.getByRole("button", { name: /submit request/i })).toBeDisabled();
  });

  it("disables submit and shows weekly cap error for eligible employee at 2-day limit", () => {
    render(<WFHRequestForm payLevel={7} weeklyWfhCount={2} />);
    const banner = screen.getByTestId("weekly-cap-error");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent(/2-day weekly WFH limit reached/i);
    expect(screen.getByRole("button", { name: /submit request/i })).toBeDisabled();
  });

  it("enables submit for eligible employee under weekly cap", () => {
    render(<WFHRequestForm payLevel={5} weeklyWfhCount={1} />);
    expect(screen.queryByTestId("gazetted-error")).not.toBeInTheDocument();
    expect(screen.queryByTestId("weekly-cap-error")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit request/i })).not.toBeDisabled();
  });

  it("shows pay-level unknown warning and allows submit when payLevel is not provided", () => {
    render(<WFHRequestForm weeklyWfhCount={0} />);
    expect(screen.getByTestId("paylevel-warning")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit request/i })).not.toBeDisabled();
  });
});
