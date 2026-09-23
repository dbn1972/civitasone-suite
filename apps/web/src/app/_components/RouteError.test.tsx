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
    expect(
      screen.getByText("We couldn't open HR page. Please try again — your information is safe.")
    ).toBeInTheDocument();
  });

  it("defaults to 'this page' when no area specified", () => {
    render(<RouteError error={mockError} reset={reset} />);
    expect(
      screen.getByText("We couldn't open this page. Please try again — your information is safe.")
    ).toBeInTheDocument();
  });

  // Regression: the message used to read "We couldn't open this {area}.", which
  // is grammatically broken for any real, caller-supplied area name that is
  // plural or a list rather than a singular "X page" noun — e.g. "this Fleet
  // Vehicles", "this Insurance Claims", "this Condemnation, Auction & Disposal".
  // These are real values passed by route error.tsx files across the app (see
  // apps/web/src/app/**/error.tsx), not hypothetical inputs. The fix drops the
  // determiner entirely (same approach as toHumanError() in lib/messages.ts),
  // so no area name needs "this"/"these"/"a"/"an" agreement.
  it.each([
    ["Fleet Vehicles", "We couldn't open Fleet Vehicles. Please try again — your information is safe."],
    ["Insurance Claims", "We couldn't open Insurance Claims. Please try again — your information is safe."],
    ["Fleet IoT Devices", "We couldn't open Fleet IoT Devices. Please try again — your information is safe."],
    ["Projects & AUC", "We couldn't open Projects & AUC. Please try again — your information is safe."],
    [
      "Condemnation, Auction & Disposal",
      "We couldn't open Condemnation, Auction & Disposal. Please try again — your information is safe.",
    ],
    ["CRM", "We couldn't open CRM. Please try again — your information is safe."],
  ])("reads naturally for the real area name %j", (area, expected) => {
    render(<RouteError error={mockError} reset={reset} area={area} />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("never renders the ungrammatical 'this <plural area>' pattern", () => {
    render(<RouteError error={mockError} reset={reset} area="Insurance Claims" />);
    expect(screen.queryByText(/this Insurance Claims/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bthis\b/)).not.toBeInTheDocument();
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
