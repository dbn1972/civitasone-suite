import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorState } from "./ErrorState";

vi.mock("@/lib/messages", () => ({
  ACTION_LABELS: {
    retry: "Try again",
    back: "Go back",
    help: "Get help",
  },
}));

describe("ErrorState", () => {
  const baseError = {
    what: "Something went wrong",
    next: "Please try again in a moment.",
    actions: ["retry" as const, "back" as const, "help" as const],
  };

  it("renders the error title (what)", () => {
    render(<ErrorState error={baseError} />);
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
  });

  it("renders the next-step message", () => {
    render(<ErrorState error={baseError} />);
    expect(screen.getByText("Please try again in a moment.")).toBeInTheDocument();
  });

  it("renders as an alert region", () => {
    render(<ErrorState error={baseError} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders retry button and calls onRetry", () => {
    const onRetry = vi.fn();
    render(<ErrorState error={baseError} onRetry={onRetry} />);
    const btn = screen.getByRole("button", { name: "Try again" });
    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalled();
  });

  it("renders back button and calls onBack", () => {
    const onBack = vi.fn();
    render(<ErrorState error={baseError} onBack={onBack} />);
    const btn = screen.getByRole("button", { name: "Go back" });
    fireEvent.click(btn);
    expect(onBack).toHaveBeenCalled();
  });

  it("renders back as link when backHref is provided", () => {
    render(<ErrorState error={baseError} backHref="/dashboard" />);
    const link = screen.getByRole("link", { name: "Go back" });
    expect(link).toHaveAttribute("href", "/dashboard");
  });

  it("renders help link", () => {
    render(<ErrorState error={baseError} />);
    expect(screen.getByRole("link", { name: "Get help" })).toHaveAttribute("href", "/help");
  });

  it("renders custom help link", () => {
    render(<ErrorState error={baseError} helpHref="/help/finance" />);
    expect(screen.getByRole("link", { name: "Get help" })).toHaveAttribute("href", "/help/finance");
  });

  it("does not render retry button when onRetry is not provided", () => {
    render(<ErrorState error={baseError} />);
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});
