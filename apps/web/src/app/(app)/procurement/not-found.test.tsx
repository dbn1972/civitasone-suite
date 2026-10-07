import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import NotFound from "./not-found";

describe("Procurement not-found action (GAP-PROCUREMENT-HOME-04)", () => {
  it("renders a working 'Back to Procurement' link to /procurement", () => {
    render(<NotFound />);
    const link = screen.getByRole("link", { name: "Back to Procurement" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/procurement");
  });

  it("still shows the not-found title", () => {
    render(<NotFound />);
    expect(screen.getByText("Page not found")).toBeInTheDocument();
  });
});
