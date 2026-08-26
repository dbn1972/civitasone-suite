import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { RefreshErrorState } from "./RefreshErrorState";

describe("RefreshErrorState", () => {
  const baseError = {
    what: "We couldn't load this meeting list.",
    next: "Check your internet connection and try again.",
    actions: ["retry" as const, "back" as const, "help" as const],
  };

  it("renders the error title", () => {
    render(<RefreshErrorState error={baseError} />);
    expect(screen.getByRole("heading", { name: baseError.what })).toBeInTheDocument();
  });

  it("renders as an alert region (same as ErrorState)", () => {
    render(<RefreshErrorState error={baseError} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("calls router.refresh() when Retry is clicked", () => {
    refreshMock.mockClear();
    render(<RefreshErrorState error={baseError} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("renders back as a link when backHref is provided", () => {
    render(<RefreshErrorState error={baseError} backHref="/meeting" />);
    expect(screen.getByRole("link", { name: "Go back" })).toHaveAttribute("href", "/meeting");
  });
});
