import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LegalNotFound from "./not-found";

describe("Legal not-found (GAP-LEGAL-HOME-03)", () => {
  it("offers a working link back to the Legal hub", () => {
    render(<LegalNotFound />);
    const link = screen.getByRole("link", { name: "Back to Legal" });
    expect(link).toHaveAttribute("href", "/legal");
  });
});
