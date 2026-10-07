import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import EstablishmentNotFound from "./not-found";

// GAP-ESTABLISHMENT-HOME-02: the not-found page (shown for unknown children such
// as /establishment/foo, since /establishment itself now config-redirects) used
// to render a dead-end EmptyState with no way back. It now offers a link back to
// the Establishment hub.
describe("EstablishmentNotFound", () => {
  it("renders the not-found heading", () => {
    render(<EstablishmentNotFound />);
    expect(
      screen.getByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
  });

  it("offers a working link back to the establishment hub", () => {
    render(<EstablishmentNotFound />);
    const link = screen.getByRole("link", { name: "Back to Establishment" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/estab");
  });
});
