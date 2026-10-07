import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecordDetailPanel } from "./RecordDetailPanel";
import { getMunicipalService } from "../_data/services";

describe("RecordDetailPanel", () => {
  const trade = getMunicipalService("trade")!;

  it("masks a phone PII field by default (DETAIL-01)", () => {
    render(
      <RecordDetailPanel
        config={trade}
        record={{ id: "a1", ownerMobile: "9876543210", businessName: "Acme", status: "submitted" }}
        title="Acme"
        reference="TL-1"
        status="submitted"
      />,
    );
    // maskPhone("9876543210") -> "98XXXXX210"; the raw number is not shown.
    expect(screen.getByText("98XXXXX210")).toBeInTheDocument();
    expect(screen.queryByText("9876543210")).not.toBeInTheDocument();
  });

  it("has no developer roadmap / 'municipal service API' copy (DETAIL-02/04)", () => {
    const { container } = render(
      <RecordDetailPanel
        config={trade}
        record={{ id: "a1", businessName: "Acme", status: "submitted" }}
        title="Acme"
        reference="TL-1"
        status="submitted"
      />,
    );
    expect(container.textContent).not.toMatch(/follow-up pass/i);
    expect(container.textContent).not.toMatch(/municipal service API/i);
    expect(container.textContent).not.toMatch(/workflow tasks/i);
  });

  it("does not render the internal id field (DETAIL-03)", () => {
    render(
      <RecordDetailPanel
        config={trade}
        record={{ id: "secret-internal-id", businessName: "Acme", status: "submitted" }}
        title="Acme"
        reference="TL-1"
        status="submitted"
      />,
    );
    expect(screen.queryByText("secret-internal-id")).not.toBeInTheDocument();
  });
});
