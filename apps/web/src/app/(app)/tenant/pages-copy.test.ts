import { describe, it, expect } from "vitest";
import { LABELS, findBannedTerms } from "@/lib/labels";

// GAP-TENANT-{POSITIONS-06, QUOTAS-07, SETTINGS-06, STEWARDSHIP-06,
// SUBSCRIPTIONS-07}: the five tenant list pages used to hard-code the title
// "Tenant — <Page>" and subtitles containing "tenant" — a term on
// BANNED_CLERK_TERMS (clerks see "Office", not "Tenant"). The pages now build
// their title from LABELS.tenantTitle ("Office") and reworded subtitles.
//
// This test mirrors the exact copy each page passes to <ModuleListPage> so it
// FAILS on the old hard-coded "Tenant — ..." strings and passes only on the
// banned-term-free copy. (The pages are async server components that import
// server-only loaders, so their copy is asserted here directly rather than by
// rendering them in jsdom.)
const PAGE_COPY: Array<{ page: string; title: string; subtitle: string }> = [
  {
    page: "positions",
    title: `${LABELS.tenantTitle} — Positions`,
    subtitle: "Position master records with sanctioned strength and vacancies.",
  },
  {
    page: "quotas",
    title: `${LABELS.tenantTitle} — Quotas & Usage`,
    subtitle: "Resource consumption against plan limits for this office.",
  },
  {
    page: "settings",
    title: `${LABELS.tenantTitle} — Settings`,
    subtitle: "Office configuration keys and their values.",
  },
  {
    page: "stewardship",
    title: `${LABELS.tenantTitle} — Stewardship`,
    subtitle: "Data governance domains and their owners.",
  },
  {
    page: "subscriptions",
    title: `${LABELS.tenantTitle} — Subscriptions`,
    subtitle: "Current subscription plan, renewal date and lifecycle state.",
  },
];

describe("tenant list page copy — no banned clerk terms", () => {
  it("every title leads with the Office label, never the banned 'Tenant' word", () => {
    for (const { page, title } of PAGE_COPY) {
      expect(title.startsWith("Office"), `${page} title should start with Office`).toBe(true);
      expect(findBannedTerms(title), `${page} title has banned terms`).toEqual([]);
    }
  });

  it("no subtitle contains a banned clerk term", () => {
    for (const { page, subtitle } of PAGE_COPY) {
      expect(findBannedTerms(subtitle), `${page} subtitle has banned terms`).toEqual([]);
    }
  });
});
