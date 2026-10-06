import { describe, it, expect } from "vitest";
import { renderWithIntl } from "@/lib/testUtils/intl";
import { screen } from "@testing-library/react";
import Loading from "./loading";

describe("linked-accounts loading (GAP-CRM-LINKED-ACCOUNTS-06)", () => {
  it("uses the one segment name 'Connected Accounts', not 'Linked Accounts'", () => {
    renderWithIntl(<Loading />);
    expect(screen.getByRole("heading", { name: "Connected Accounts" })).toBeInTheDocument();
    expect(screen.queryByText("Linked Accounts")).not.toBeInTheDocument();
  });

  it("renders a single card-shaped skeleton (not a four-tile stat grid)", () => {
    const { container } = renderWithIntl(<Loading />);
    // One card with form + table-row skeletons; the old loader drew a 4-tile grid
    // and a 280px block the page never renders.
    expect(container.querySelector(".card")).not.toBeNull();
    // No fixed-height 280px block (the old loader's hallmark).
    const has280 = Array.from(container.querySelectorAll("div")).some(
      (d) => (d as HTMLElement).style.height === "280px",
    );
    expect(has280).toBe(false);
  });
});
