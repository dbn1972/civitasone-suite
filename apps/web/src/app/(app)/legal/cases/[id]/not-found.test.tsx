import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LegalCaseNotFound from "./not-found";

describe("Legal case not-found breadcrumb (GAP-LEGAL-CASES-DETAIL-03)", () => {
  it("starts the breadcrumb at Legal (not Audit) and links back correctly", () => {
    render(<LegalCaseNotFound />);
    const legal = screen.getByRole("link", { name: "Legal" });
    expect(legal).toHaveAttribute("href", "/legal");
    expect(screen.queryByRole("link", { name: "Audit" })).not.toBeInTheDocument();
    const back = screen.getByRole("link", { name: /Back to cases/i });
    expect(back).toHaveAttribute("href", "/legal/list");
  });
});
