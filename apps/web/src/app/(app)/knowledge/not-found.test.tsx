import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import KnowledgeNotFound from "./not-found";

// GAP-KNOWLEDGE-HOME-03: not-found must offer a way back to Knowledge.
describe("KnowledgeNotFound", () => {
  it("renders a Back to Knowledge link and a Policies link", () => {
    render(<KnowledgeNotFound />);
    expect(screen.getByRole("link", { name: "Back to Knowledge" })).toHaveAttribute("href", "/knowledge");
    expect(screen.getByRole("link", { name: /SOPs & Policies/ })).toHaveAttribute("href", "/knowledge/policies");
    expect(screen.getByText(/no longer have access/i)).toBeInTheDocument();
  });
});
