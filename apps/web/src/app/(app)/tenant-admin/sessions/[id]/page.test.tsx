import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import SessionDetailPage from "./page";

/**
 * UX-009 follow-up — integration check: this page renders a real
 * PlaceholderButton in production ("Revoke Session", with a custom
 * aria-label). Confirms the fix in place, not just in the shared component's
 * own isolated tests: the button is a genuinely disabled control, and
 * clicking it never fires the window.alert() popup it used to.
 */
describe("SessionDetailPage — PlaceholderButton integration (UX-009 follow-up)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders 'Revoke Session' as an honest disabled control, not a live alert-firing button", () => {
    render(<SessionDetailPage params={{ id: "sess-a1b2c3d4" }} />);

    const btn = screen.getByRole("button", { name: "Revoke this session" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn).toHaveTextContent("(coming soon)");
  });

  it("never calls window.alert for this page's Revoke Session button", () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<SessionDetailPage params={{ id: "sess-a1b2c3d4" }} />);

    const btn = screen.getByRole("button", { name: "Revoke this session" });
    btn.click();

    expect(alertSpy).not.toHaveBeenCalled();
  });
});
