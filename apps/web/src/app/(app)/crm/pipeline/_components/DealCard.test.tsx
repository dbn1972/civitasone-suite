import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DealCard } from "./DealCard";
import type { PipelineDealCard } from "../../../../_data/loaders";

const DEAL: PipelineDealCard = {
  id: "d1",
  name: "Statewide LMS rollout",
  stageId: "s1",
  stage: "prospecting",
  valueMinor: "5000000",
  valueDisplay: "₹50,000.00",
  probability: 40,
  ownerId: "u1",
  contactName: "Officer A",
  version: 1,
  prediction: null,
};

describe("DealCard (GAP-CRM-PIPELINE-06)", () => {
  it("exposes the engagement link in the tab order (no tabIndex=-1) so keyboard users can open the record", () => {
    render(
      <DealCard
        deal={DEAL}
        isMoving={false}
        isDragging={false}
        onDragStart={vi.fn()}
        onKeyboardMove={vi.fn()}
      />,
    );
    const link = screen.getByRole("link", { name: DEAL.name });
    expect(link).toHaveAttribute("href", "/crm/deals/d1");
    // The regression: the link previously carried tabIndex="-1", removing it from
    // the tab order. It must not be negatively tabindexed now.
    expect(link).not.toHaveAttribute("tabindex", "-1");
  });

  it("tells assistive-tech users how to open the record in the card's accessible name", () => {
    render(
      <DealCard
        deal={DEAL}
        isMoving={false}
        isDragging={false}
        onDragStart={vi.fn()}
        onKeyboardMove={vi.fn()}
      />,
    );
    const card = screen.getByRole("button", { name: /Engagement: Statewide LMS rollout/ });
    expect(card).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Tab to the engagement name and press Enter to open its record"),
    );
  });
});
