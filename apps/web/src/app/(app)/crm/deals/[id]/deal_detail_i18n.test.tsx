import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { DealDetailActions } from "./DealDetailActions";
import { stripComments } from "@/lib/testUtils/stripComments";

/**
 * GAP-CRM-DEALS-DETAIL-06: DealDetailActions uses i18n keys, no hex literals.
 * Hex colors were already replaced with CSS tokens (var(--good)/var(--bad)) in
 * a prior wave; this test verifies the string literals are now in en.json.
 */
describe("GAP-CRM-DEALS-DETAIL-06 — DealDetailActions i18n", () => {
  const ns = (enMessages as unknown as Record<string, Record<string, string>>)["crmDealDetail"] ?? {};

  it("markWon key exists", () => {
    expect(ns.markWon).toBeTruthy();
  });

  it("markLost key exists", () => {
    expect(ns.markLost).toBeTruthy();
  });

  it("no hex literals in crmDealDetail namespace", () => {
    const allValues = JSON.stringify(ns);
    expect(allValues).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});

/** Source text with line and block comments removed, so scans see only code. */
function code(file: string): string {
  return stripComments(readFileSync(join(__dirname, file), "utf8"));
}

describe("GAP-CRM-DEALS-DETAIL-06 — the components actually use the catalogue", () => {
  it("DealDetailActions renders the log-activity form in the active locale (hi), not hard-coded English", () => {
    render(
      <NextIntlClientProvider locale="hi" messages={hiMessages}>
        <DealDetailActions dealId="d1" dealName="नगर निगम अनुबंध" status="open" />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: hiMessages.crmDealDetail.logActivity }));
    const ns = hiMessages.crmDealDetail;
    expect(screen.getByText(ns.logActivityFor.split("{name}").join("नगर निगम अनुबंध"))).toBeInTheDocument();
    expect(screen.getByLabelText(ns.fieldType)).toBeInTheDocument();
    expect(screen.getByLabelText(ns.fieldSubject)).toBeInTheDocument();
    expect(screen.getByLabelText(new RegExp(`^${ns.fieldNotes}`))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ns.saveActivity })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ns.cancel })).toBeInTheDocument();
    expect(screen.queryByText("Save activity")).not.toBeInTheDocument();
    expect(screen.queryByText("Short summary")).not.toBeInTheDocument();
  });

  it.each(["DealDetailActions.tsx", "page.tsx"])("%s has no hex colour literal (theme tokens only)", (file) => {
    expect(code(file)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it.each([
    "Activity logged.",
    "Short summary",
    "What happened?",
    "Save activity",
    "Engagement Details",
    "Contact / Organisation",
    "Close Date",
    "Stakeholder Engagement System",
  ])("neither component keeps the literal %j (it lives in crmDealDetail)", (literal) => {
    for (const file of ["DealDetailActions.tsx", "page.tsx"]) {
      expect(code(file)).not.toContain(literal);
    }
  });

  it("every static t(...) key the two components read exists in both en.json and hi.json", () => {
    const keys = new Set<string>();
    for (const file of ["DealDetailActions.tsx", "page.tsx"]) {
      for (const m of code(file).matchAll(/\b(?:t|tErr)\(\s*"([A-Za-z.]+)"/g)) keys.add(m[1]);
    }
    expect(keys.size).toBeGreaterThan(20);
    const lookup = (root: Record<string, unknown>, path: string): unknown =>
      path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), root);
    for (const key of keys) {
      expect(lookup(enMessages.crmDealDetail as Record<string, unknown>, key), `en crmDealDetail.${key}`).toBeTruthy();
      expect(lookup(hiMessages.crmDealDetail as Record<string, unknown>, key), `hi crmDealDetail.${key}`).toBeTruthy();
    }
  });

  it("the error-state title and load area use the canonical noun (Engagement), not Deal", () => {
    expect(enMessages.crmDealDetail.detailTitle).toBe("Engagement Detail");
    expect(enMessages.crmDealDetail.loadArea).toBe("this engagement");
  });
});
