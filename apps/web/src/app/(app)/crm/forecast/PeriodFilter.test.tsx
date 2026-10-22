import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/lib/testUtils/intl";
import { PeriodFilter } from "./PeriodFilter";

// GAP-CRM-FORECAST-06: the default horizon option uses the CRM's own word for the thing
// being forecast ("engagements", as on the hub and the board), not "deals".
describe("PeriodFilter wording (GAP-CRM-FORECAST-06)", () => {
  it("offers 'All open engagements' as the no-filter option", () => {
    renderWithIntl(<PeriodFilter />);
    const select = screen.getByLabelText(/filter forecast by period/i) as HTMLSelectElement;
    const first = select.options[0]!;
    expect(first.value).toBe("");
    expect(first.textContent).toBe("All open engagements");
    expect(screen.queryByRole("option", { name: /deals/i })).not.toBeInTheDocument();
  });
});
