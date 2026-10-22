import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { PromotionBatchView } from "./PromotionBatchView";
import type { PromotionRow } from "../../promotion/_components/PromotionCard";

function renderView(promotions: PromotionRow[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PromotionBatchView promotions={promotions} />
    </NextIntlClientProvider>,
  );
}

// A status pill inside a promotion card can carry the same words as a tile label
// ("Initiated"), so look the tile up by its .lab element, not by free text.
function stat(label: string): number {
  const lab = [...document.querySelectorAll(".stat .lab, .lab")].find((el) => el.textContent === label);
  if (!lab) throw new Error(`no stat tile labelled "${label}"`);
  return Number(lab.parentElement?.querySelector(".val")?.textContent);
}

const row = (id: string, status: string): PromotionRow => ({ id, employeeName: `Emp ${id}`, status });

describe("PromotionBatchView stat tiles (GAP-HR-DPC-02)", () => {
  it("counts the statuses the live workflow writes, and the tiles add up to the total", () => {
    renderView([
      row("1", "pending"),
      row("2", "pending_approval"), row("3", "pending_approval"),
      row("4", "pending_effective"),
      row("5", "completed"),
      row("6", "cancelled"),
    ]);
    expect(stat("Total in Batch")).toBe(6);
    expect(stat("Initiated")).toBe(1);
    expect(stat("In Approval")).toBe(2);
    expect(stat("Approved, Awaiting Effective Date")).toBe(1);
    expect(stat("Signed & Issued")).toBe(1);
    expect(stat("Cancelled")).toBe(1);
    expect(stat("Initiated") + stat("In Approval") + stat("Approved, Awaiting Effective Date") + stat("Signed & Issued") + stat("Cancelled")).toBe(stat("Total in Batch"));
  });

  it("shows an 'Other' tile only when a row has a status it does not know", () => {
    renderView([row("1", "pending"), row("2", "mystery_status")]);
    expect(stat("Other")).toBe(1);
    expect(stat("Initiated") + stat("Other")).toBe(stat("Total in Batch"));
  });

  it("has no 'Other' tile when everything is recognised", () => {
    renderView([row("1", "pending")]);
    expect(() => stat("Other")).toThrow();
  });

  it("renders the empty state for no promotions", () => {
    renderView([]);
    expect(screen.getByText("No DPC promotions recorded")).toBeInTheDocument();
  });
});
