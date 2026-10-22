import { describe, it, expect, vi } from "vitest";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { DealCard } from "./DealCard";
import type { PipelineDealCard } from "../../../../_data/loaders";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

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

function renderCard(onKeyboardMove = vi.fn()) {
  return render(
    <DealCard deal={DEAL} isMoving={false} isDragging={false} onDragStart={vi.fn()} onKeyboardMove={onKeyboardMove} />,
  );
}

describe("DealCard (GAP-CRM-PIPELINE-06)", () => {
  it("exposes the engagement link in the tab order (no tabIndex=-1) so keyboard users can open the record", () => {
    renderCard();
    const link = screen.getByRole("link", { name: DEAL.name });
    expect(link).toHaveAttribute("href", "/crm/deals/d1");
    // The regression: the link previously carried tabIndex="-1", removing it from
    // the tab order. It must not be negatively tabindexed now.
    expect(link).not.toHaveAttribute("tabindex", "-1");
  });

  it("tells assistive-tech users how to open the record in the card's accessible name", () => {
    renderCard();
    const card = screen.getByRole("group", { name: /Engagement: Statewide LMS rollout/ });
    expect(card).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Tab to the engagement name and press Enter to open its record"),
    );
    expect(card).toHaveAttribute("aria-label", expect.stringContaining("assignee Officer A"));
  });

  it("keeps the card mouse-draggable", () => {
    renderCard();
    expect(screen.getByRole("group", { name: /Statewide LMS rollout/ })).toHaveAttribute("draggable", "true");
  });

  // The card is no longer role=button around the link: the keyboard move lives on its own
  // <button> handle, so the link and the move control are two separate controls.
  it("moves with the arrow keys on a dedicated move handle, not on a button wrapping the link", () => {
    const onKeyboardMove = vi.fn();
    renderCard(onKeyboardMove);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    const handle = buttons[0]!;
    expect(handle).toHaveAttribute("aria-label", expect.stringContaining("arrow keys"));
    expect(handle).not.toContainElement(screen.getByRole("link", { name: DEAL.name }));
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(onKeyboardMove).toHaveBeenNthCalledWith(1, "d1", "right");
    expect(onKeyboardMove).toHaveBeenNthCalledWith(2, "d1", "left");
    expect(onKeyboardMove).toHaveBeenCalledTimes(2);
  });

  // GAP-CRM-PIPELINE-06 acceptance: "axe: no nested-interactive violation". The old card
  // (role=button containing the <a>) fails this rule.
  it("has no axe violations — in particular no nested-interactive (colour contrast needs a real browser)", async () => {
    const axe = (await import("axe-core")).default;
    const { container } = renderCard();
    const out = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(out.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});
