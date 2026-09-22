import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FirstRunTour } from "./FirstRunTour";

const STORAGE_KEY = "civitasone.tour.dashboard.v1";

describe("FirstRunTour", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows on a first visit (no stored flag)", () => {
    render(<FirstRunTour />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Welcome to CivitasOne")).toBeInTheDocument();
  });

  it("does not show once the flag is already stored (a returning session)", () => {
    localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    render(<FirstRunTour />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Skip closes the dialog and persists the flag", () => {
    render(<FirstRunTour />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy();
  });

  it("a remount after Skip (simulating navigating away and back) stays closed", () => {
    const { unmount } = render(<FirstRunTour />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    unmount();

    render(<FirstRunTour />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Escape closes the dialog and persists the flag", () => {
    render(<FirstRunTour />);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy();
  });

  it("clicking the backdrop closes the dialog and persists the flag", () => {
    render(<FirstRunTour />);
    // The backdrop is the dialog's own presentation-role ancestor; only a
    // click on it directly (not a bubbled click from inside the card) closes.
    fireEvent.click(screen.getByRole("presentation"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy();
  });

  it("Next advances through steps and the last step offers Start setup", () => {
    render(<FirstRunTour />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Help is always one click away")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start setup" })).toHaveAttribute("href", "/setup");
  });

  it("renders above the persistent floating overlays (Ask, feedback) while open", () => {
    render(<FirstRunTour />);
    const backdrop = screen.getByRole("presentation");
    // Regression guard for the z-index fix: this is an aria-modal dialog, so
    // it must out-rank AskCivitasOne (1100) and FeedbackWidget (1000), both
    // mounted as permanent siblings in AppShell.
    expect(Number((backdrop as HTMLElement).style.zIndex)).toBeGreaterThan(1100);
  });
});
