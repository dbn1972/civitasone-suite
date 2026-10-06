import { describe, it, expect } from "vitest";
import { renderWithIntl } from "@/lib/testUtils/intl";
import { screen } from "@testing-library/react";
import Loading from "./loading";

describe("opportunity-ageing loading (GAP-CRM-OPPORTUNITY-AGEING-06)", () => {
  it("uses the same heading as the loaded page ('Stage Ageing'), not 'Opportunity Ageing'", () => {
    renderWithIntl(<Loading />);
    expect(screen.getByRole("heading", { name: "Stage Ageing" })).toBeInTheDocument();
    expect(screen.queryByText("Opportunity Ageing")).not.toBeInTheDocument();
  });

  it("renders two card-shaped skeletons, not a four-tile stat grid", () => {
    const { container } = renderWithIntl(<Loading />);
    // Two card blocks (breaches + stage day limits); the old loader rendered a
    // 4-tile grid the page never shows.
    const blocks = container.querySelectorAll(".animate-pulse > div");
    expect(blocks).toHaveLength(2);
  });
});
