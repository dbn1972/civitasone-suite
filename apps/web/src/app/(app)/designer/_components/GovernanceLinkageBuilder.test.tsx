/**
 * GAP-DESIGNER-DETAIL-B1-04: appellate authority and PIO designations are chosen
 * from the tenant positions registry (a <select>), not typed as free-text
 * snake_case tokens. We mock fetchTenantPositions so the dropdown is populated.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const fetchPositions = vi.fn();
vi.mock("../_data/workflowBuilderApi", () => ({
  fetchTenantPositions: () => fetchPositions(),
}));

import { GovernanceLinkageBuilder } from "./GovernanceLinkageBuilder";

const baseProps = {
  appeal: null,
  rti: null,
  locales: ["en", "or"],
  onAppealChange: () => {},
  onRtiChange: () => {},
  onLocalesChange: () => {},
};

describe("GovernanceLinkageBuilder position picker (GAP-DESIGNER-DETAIL-B1-04)", () => {
  beforeEach(() => {
    fetchPositions.mockReset();
    fetchPositions.mockResolvedValue([
      { id: "pos-1", label: "Additional Commissioner" },
      { id: "pos-2", label: "Deputy Commissioner" },
    ]);
  });

  it("renders a designation <select> (not a free-text input) for the appellate authority", async () => {
    render(<GovernanceLinkageBuilder {...baseProps} appeal={{ appealable: true }} />);
    const select = (await screen.findByLabelText("Appellate authority designation")) as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Additional Commissioner" })).toBeTruthy();
    });
  });

  it("renders a designation <select> for the PIO", async () => {
    render(<GovernanceLinkageBuilder {...baseProps} rti={{ published: true }} />);
    const select = (await screen.findByLabelText("Public Information Officer designation")) as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
  });

  it("shows a retry affordance when the positions fetch fails", async () => {
    fetchPositions.mockRejectedValue(new Error("boom"));
    render(<GovernanceLinkageBuilder {...baseProps} appeal={{ appealable: true }} />);
    await waitFor(() => {
      expect(screen.getByText(/Could not load positions/i)).toBeTruthy();
    });
  });
});
