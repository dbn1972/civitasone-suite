import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PlatformAdminError from "./error";
import PlatformAdminNotFound from "./not-found";

describe("platform-admin error/not-found boundaries (GAP-PLATFORM-ADMIN-HOME-05)", () => {
  it("error boundary offers Retry and a 'Back to Platform Admin' link", () => {
    const reset = vi.fn();
    render(<PlatformAdminError error={new Error("boom")} reset={reset} />);
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
    const back = screen.getByRole("link", { name: /back to platform admin/i });
    expect(back).toHaveAttribute("href", "/platform-admin");
  });

  it("not-found renders a page-not-found message", () => {
    render(<PlatformAdminNotFound />);
    expect(screen.getByText(/page not found/i)).toBeInTheDocument();
  });
});
