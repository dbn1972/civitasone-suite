import { describe, it, expect, vi } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { DeputationCard, type DeputationRow } from "./DeputationCard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const withLocale = (locale: "en" | "hi", ui: ReactElement) =>
  rtlRender(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? enMessages : hiMessages}>{ui}</NextIntlClientProvider>,
  );

const future = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
const ROW: DeputationRow = {
  id: "dep-1", employee: "Asha Rao", parentOrg: "Finance", deputationOrg: "Ministry of Finance",
  fromDate: "2026-01-01", toDate: future, period: "1 yr", deputationAllowanceMinor: 250000, status: "active",
};

describe("DeputationCard role + status gating (GAP-HR-DEPUTATION-02)", () => {
  it("shows Repatriate and Cancel on an active deputation for an HR role", () => {
    withLocale("en", <DeputationCard deputation={ROW} canManage />);
    expect(screen.getByRole("button", { name: "Repatriate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("shows no action buttons to a non-HR role", () => {
    withLocale("en", <DeputationCard deputation={ROW} canManage={false} />);
    expect(screen.queryByRole("button", { name: "Repatriate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it.each(["repatriated", "cancelled"])("offers nothing on a %s deputation, even to an HR role", (status) => {
    withLocale("en", <DeputationCard deputation={{ ...ROW, status }} canManage />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

// GAP-HR-DEPUTATION-06: the card is a "use client" component inside a translated page.
describe("DeputationCard i18n (GAP-HR-DEPUTATION-06)", () => {
  it("renders every label in Hindi, with no English label strings left", () => {
    const { container } = withLocale("hi", <DeputationCard deputation={ROW} canManage />);
    const hi = hiMessages.deputation.card;
    for (const text of [hi.deputedTo, hi.startDate, hi.expectedEnd, hi.period, hi.allowance, hi.status.active, hi.repatriate, hi.cancel]) {
      expect(screen.getAllByText(text).length, text).toBeGreaterThan(0);
    }
    const en = enMessages.deputation.card;
    for (const text of [en.deputedTo, en.startDate, en.expectedEnd, en.allowance, en.status.active, en.repatriate, en.cancel]) {
      expect(screen.queryByText(text), text).not.toBeInTheDocument();
    }
    expect(screen.getByLabelText("Asha Rao की प्रतिनियुक्ति")).toBeInTheDocument();
    // the "N days left" cue is the ICU message, translated
    expect(container.textContent).toMatch(/दिन शेष/);
    expect(container.textContent).not.toMatch(/days? left|Overdue/);
  });

  it("renders the status of an unknown/legacy deputation as given, not as a missing key path", () => {
    withLocale("hi", <DeputationCard deputation={{ ...ROW, status: "recalled" }} />);
    expect(screen.getByText("recalled")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/deputation\.card\./);
  });

  it("DeputationCard.tsx has no hard-coded user-facing text", () => {
    const code = readFileSync(join(process.cwd(), "src/app/(app)/hr/deputation/_components/DeputationCard.tsx"), "utf8");
    // no literal text between JSX tags (a {t(...)} expression is fine)
    expect(code.match(/<\/?[A-Za-z][^<>]*>\s*([^<>{}\n]*[A-Za-z][^<>{}\n]*?)\s*</g)).toBeNull();
    for (const english of ["Deputed to", "Start Date", "Expected End Date", "Recall Initiated", "Overdue", "Unknown", "Deputation for"]) {
      expect(code, english).not.toMatch(new RegExp(`["'>]${english}[^a-zA-Z]`));
    }
    expect(code).not.toContain("STATUS_LABEL");
  });
});
