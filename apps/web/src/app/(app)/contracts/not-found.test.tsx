import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ContractsNotFound from "./not-found";

// GAP-CONTRACTS-HOME-01 / HOME-03: a direct visit to a bad URL under
// /contracts must offer a way back to the hub, not strand the user on a
// dead-end "Page not found" with no action.
describe("Contracts not-found", () => {
  it("offers a link back to the Contracts hub", () => {
    render(<ContractsNotFound />);
    const back = screen.getByRole("link", { name: /back to contracts/i });
    expect(back).toHaveAttribute("href", "/contracts");
  });
});
