import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlaceholderButton } from "./PlaceholderButton";

/**
 * UX-009 follow-up: PlaceholderButton used to fire a raw window.alert() on
 * click ('"<label>" is not yet available...'). This app's own established
 * convention for a not-yet-wired action (see estab/meetings/[id]/
 * MeetingActions.tsx and estab/meetings/page.tsx) is an honest disabled
 * control instead: `disabled` + `aria-disabled="true"` + a `title` tooltip +
 * a visible "(coming soon)" tag. These tests pin that behavior and prove the
 * alert is gone for good.
 */
describe("PlaceholderButton — honest disabled state, not a window.alert (UX-009 follow-up)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a real disabled button, not an active one", () => {
    render(<PlaceholderButton label="Contempt watch" />);
    const btn = screen.getByRole("button", { name: /Contempt watch/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-disabled", "true");
  });

  it("shows a visible (coming soon) tag and an explanatory title tooltip", () => {
    render(<PlaceholderButton label="Invite user" />);
    const btn = screen.getByRole("button", { name: /Invite user/i });
    expect(btn).toHaveTextContent("(coming soon)");
    expect(btn).toHaveAttribute("title", '"Invite user" is not yet available. This feature is coming soon.');
  });

  it("never calls window.alert when clicked", () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<PlaceholderButton label="Filter" />);
    const btn = screen.getByRole("button", { name: /Filter/i });

    fireEvent.click(btn);

    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("respects a caller-supplied aria-label as the accessible name", () => {
    render(<PlaceholderButton label="Revoke Session" aria-label="Revoke this session" />);
    expect(screen.getByRole("button", { name: "Revoke this session" })).toBeDisabled();
  });

  it("defaults to the ghost variant and applies the caller's style", () => {
    render(<PlaceholderButton label="Search precedents" style={{ minHeight: 44 }} />);
    const btn = screen.getByRole("button", { name: /Search precedents/i });
    expect(btn).toHaveClass("btn", "ghost");
    expect(btn).toHaveStyle({ minHeight: "44px" });
  });

  it("applies the caller's variant override (e.g. primary, as tenant-admin's 'Invite user' uses)", () => {
    render(<PlaceholderButton label="Invite user" variant="primary" />);
    const btn = screen.getByRole("button", { name: /Invite user/i });
    expect(btn).toHaveClass("btn", "primary");
  });
});
