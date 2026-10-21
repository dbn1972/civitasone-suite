import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

function renderCard(p: PromotionRow) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PromotionCard promotion={p} />
    </NextIntlClientProvider>,
  );
}

const EMP_ID = "0b6f6b1e-3d6e-4c5a-9b6e-1c2d3e4f5a6b";
const FROM_ID = "7a1c9d2e-5b4f-4e8a-8c3d-9e0f1a2b3c4d";
const TO_ID = "c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f";

// GAP-HR-DPC-02 acceptance: "PromotionCard never renders employeeId/…DesigId".
describe("PromotionCard never shows a raw id (GAP-HR-DPC-02)", () => {
  it("a row that carries ONLY ids prints 'Unknown employee' and dashes, not the UUIDs", () => {
    const { container } = renderCard({ id: "p1", employeeId: EMP_ID, fromDesigId: FROM_ID, toDesigId: TO_ID, status: "pending_approval" });
    expect(screen.getByText("Unknown employee")).toBeInTheDocument();
    expect(container.textContent).not.toContain(EMP_ID);
    expect(container.textContent).not.toContain(FROM_ID);
    expect(container.textContent).not.toContain(TO_ID);
    expect(container.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2); // from and to designation
  });

  it("a row with resolved names shows the names (and still no ids)", () => {
    const { container } = renderCard({
      id: "p1", employeeId: EMP_ID, fromDesigId: FROM_ID, toDesigId: TO_ID,
      employeeName: "B Singh", department: "Revenue", fromDesignationName: "Section Officer", toDesignationName: "Under Secretary",
      status: "pending_effective", effectiveDate: "2026-07-01", orderRef: "ORD/2026/11",
    });
    expect(screen.getByText("B Singh")).toBeInTheDocument();
    expect(screen.getByText("Under Secretary")).toBeInTheDocument();
    expect(screen.getByText("ORD/2026/11")).toBeInTheDocument();
    expect(container.textContent).not.toContain(EMP_ID);
  });

  it("does not render a 'DPC Meeting Date' it has no data for", () => {
    renderCard({ id: "p1", employeeName: "B Singh", status: "pending" });
    expect(screen.queryByText(/DPC Meeting Date/i)).not.toBeInTheDocument();
  });

  it("grep guard: the component source never reads employeeId / fromDesigId / toDesigId into the output", () => {
    const src = readFileSync(join(process.cwd(), "src/app/(app)/hr/promotion/_components/PromotionCard.tsx"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // the ids exist on the PromotionRow TYPE (the API sends them) but must never be dereferenced for display
    expect(code).not.toMatch(/promotion\.employeeId/);
    expect(code).not.toMatch(/promotion\.fromDesigId/);
    expect(code).not.toMatch(/promotion\.toDesigId/);
    expect(code).not.toMatch(/\{\s*promotion\.[a-zA-Z]*Id\s*\}/);
  });
});
