import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AppError from "./error";

// GAP-REVENUE-HOME-04: the (app) root error boundary is what /revenue home and
// every (app) route without its own error.tsx falls through to. It must read as
// a grammatical, honest sentence — never the old "We couldn't open page."
// pattern. RouteError defaults the area noun to "page" when no prop is passed,
// so the boundary passes no determiner-bearing area ("this page"), avoiding the
// double-determiner bug documented in RouteError.
describe("(app) root error boundary", () => {
  const error = Object.assign(new Error("boom"), { digest: "ref-1" });

  it("renders a grammatical, determiner-free load message (not 'open page')", () => {
    render(<AppError error={error} reset={vi.fn()} />);
    expect(
      screen.getByRole("heading", {
        name: "We couldn't load the page because of a problem on our side.",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/couldn't open page/i)).not.toBeInTheDocument();
    // No stray determiner such as "this page".
    expect(screen.queryByText(/this page/i)).not.toBeInTheDocument();
  });

  it("offers Try again and a safe way back to the dashboard", () => {
    render(<AppError error={error} reset={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Dashboard" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });
});
