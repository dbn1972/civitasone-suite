import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RouteError } from "./RouteError";

vi.mock("@/lib/messages", () => ({
  SUPPORT_REFERENCE_PREFIX: "Reference:",
}));

describe("RouteError", () => {
  const mockError = Object.assign(new Error("DB connection failed"), { digest: "abc-123" });
  const reset = vi.fn();

  it("renders 'Something went wrong' heading", () => {
    render(<RouteError error={mockError} reset={reset} />);
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
  });

  it("does not expose raw error message to the clerk", () => {
    render(<RouteError error={mockError} reset={reset} />);
    expect(screen.queryByText("DB connection failed")).not.toBeInTheDocument();
  });

  it("shows support reference code when digest is present", () => {
    render(<RouteError error={mockError} reset={reset} />);
    expect(screen.getByText(/Reference:/)).toBeInTheDocument();
    expect(screen.getByText(/abc-123/)).toBeInTheDocument();
  });

  it("uses the area name in the message", () => {
    render(<RouteError error={mockError} reset={reset} area="HR page" />);
    expect(screen.getByText(/couldn.*open this HR page/)).toBeInTheDocument();
  });

  it("defaults to 'page' when no area specified", () => {
    render(<RouteError error={mockError} reset={reset} />);
    expect(screen.getByText(/couldn.*open this page/)).toBeInTheDocument();
  });

  it("calls reset when 'Try again' is clicked", () => {
    render(<RouteError error={mockError} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalled();
  });

  it("renders back link to dashboard by default", () => {
    render(<RouteError error={mockError} reset={reset} />);
    expect(screen.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute("href", "/dashboard");
  });

  it("renders custom back link and label", () => {
    render(<RouteError error={mockError} reset={reset} backHref="/finance" backLabel="Back to finance" />);
    expect(screen.getByRole("link", { name: "Back to finance" })).toHaveAttribute("href", "/finance");
  });

  it("renders help link", () => {
    render(<RouteError error={mockError} reset={reset} />);
    expect(screen.getByRole("link", { name: "Open help" })).toHaveAttribute("href", "/help");
  });

  it("has role=alert for screen readers", () => {
    render(<RouteError error={mockError} reset={reset} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
