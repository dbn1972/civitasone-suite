import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RouteError } from "./RouteError";

describe("RouteError", () => {
  const mockError = Object.assign(new Error("DB connection failed"), { digest: "abc-123" });
  const reset = vi.fn();

  it("uses the standard 5xx copy: what happened, what to do next, no 'Something went wrong'", () => {
    render(<RouteError error={mockError} reset={reset} />);
    expect(
      screen.getByRole("heading", { name: "We couldn't load the page because of a problem on our side." }),
    ).toBeInTheDocument();
    expect(screen.getByText("Try again in a few minutes.")).toBeInTheDocument();
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });

  it("says it could not connect when the browser is offline", () => {
    const spy = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    render(<RouteError error={mockError} reset={reset} />);
    expect(screen.getByRole("heading", { name: "We couldn't connect." })).toBeInTheDocument();
    expect(screen.getByText("Check your internet connection and try again.")).toBeInTheDocument();
    spy.mockRestore();
  });

  it("does not expose raw error message to the clerk", () => {
    render(<RouteError error={mockError} reset={reset} />);
    expect(screen.queryByText("DB connection failed")).not.toBeInTheDocument();
  });

  it("shows support reference code when digest is present", () => {
    render(<RouteError error={mockError} reset={reset} />);
    expect(screen.getByText("Reference: abc-123")).toBeInTheDocument();
  });

  it("uses the area name in the message", () => {
    render(<RouteError error={mockError} reset={reset} area="HR page" />);
    expect(
      screen.getByText("We couldn't load the HR page because of a problem on our side.")
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
    ["Fleet Vehicles", "We couldn't load the Fleet Vehicles because of a problem on our side."],
    ["Insurance Claims", "We couldn't load the Insurance Claims because of a problem on our side."],
    ["Fleet IoT Devices", "We couldn't load the Fleet IoT Devices because of a problem on our side."],
    ["Projects & AUC", "We couldn't load the Projects & AUC because of a problem on our side."],
    [
      "Condemnation, Auction & Disposal",
      "We couldn't load the Condemnation, Auction & Disposal because of a problem on our side.",
    ],
    ["CRM", "We couldn't load the CRM because of a problem on our side."],
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
