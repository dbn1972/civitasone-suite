import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { PromotionCard, type PromotionRow } from "./PromotionCard";

const show = (p: PromotionRow) =>
  render(<NextIntlClientProvider locale="en" messages={enMessages}><PromotionCard promotion={p} /></NextIntlClientProvider>);

describe("PromotionCard fed by GET /v1/hrms/promotions (GAP-HR-PROMOTION-01)", () => {
  const base: PromotionRow = {
    id: "p1", employee: "Asha Rao", department: "Home Department", fromGrade: "Section Officer", toGrade: "Under Secretary",
    effectiveDate: "2026-04-01", orderNo: "PROMO/2026/014", orderRef: "PROMO/2026/014", newBasicMinor: "4550000", status: "pending_effective",
  };

  it("shows the names, the grades, the order number and the new basic (₹45,500.00)", () => {
    show(base);
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByText("Home Department")).toBeInTheDocument();
    expect(screen.getByText("Section Officer")).toBeInTheDocument();
    expect(screen.getByText("Under Secretary")).toBeInTheDocument();
    expect(screen.getByText("PROMO/2026/014")).toBeInTheDocument();
    expect(screen.getByText(/45,500/)).toBeInTheDocument();
  });

  it("does not print the list route's '—' placeholder as an order number", () => {
    show({ ...base, orderNo: "—", orderRef: null });
    expect(screen.queryByText(enMessages.promotionCard.orderNoLabel)).not.toBeInTheDocument();
  });

  it("falls back to the order reference when only the raw lifecycle shape is given", () => {
    show({ ...base, orderNo: undefined, orderRef: "RAW/9" });
    expect(screen.getByText("RAW/9")).toBeInTheDocument();
  });

  it("shows '—' for an unresolved employee or grade, never an id", () => {
    show({ ...base, employee: "—", fromGrade: "—", toGrade: "—", employeeId: "11111111-1111-4111-8111-111111111111" });
    expect(document.body.textContent).not.toMatch(/11111111-1111/);
  });
});
