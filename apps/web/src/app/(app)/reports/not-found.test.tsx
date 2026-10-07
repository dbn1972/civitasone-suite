import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ReportsNotFound from "./not-found";

describe("Reports not-found (GAP-REPORTS-HOME-02)", () => {
  it("offers a 'Back to Reports' link out", () => {
    render(<ReportsNotFound />);
    expect(screen.getByRole("link", { name: "Back to Reports" })).toHaveAttribute("href", "/reports");
  });
});
