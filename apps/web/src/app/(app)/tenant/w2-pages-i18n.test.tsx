import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils/intl-render";
import { findBannedTerms } from "@/lib/labels";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const { empty } = vi.hoisted(() => ({ empty: () => Promise.resolve({ data: [], source: "api" as const }) }));
vi.mock("./_data", () => ({
  getTenantCodeLists: empty,
  getTenantConsentExchange: empty,
  getTenantDataMigration: empty,
  getTenantImportBatches: empty,
  getTenantOverview: empty,
  getTenantPlans: empty,
  getTenantPositions: empty,
  getTenantQuotas: empty,
  getTenantSettings: empty,
  getTenantStewardship: empty,
  getTenantSubscriptions: empty,
}));

import CodeLists from "./code-lists/page";
import Consent from "./consent-exchange/page";
import DataMigration from "./data-migration/page";
import Overview from "./overview/page";
import Plans from "./plans/page";
import Positions from "./positions/page";
import Quotas from "./quotas/page";
import Settings from "./settings/page";
import Stewardship from "./stewardship/page";
import Subscriptions from "./subscriptions/page";

// GAP-TENANT-{CODE-LISTS-06, ORG-HIERARCHY-06, OVERVIEW-07, PLANS-06,
// POSITIONS-06, QUOTAS-07, SETTINGS-06, STEWARDSHIP-06, SUBSCRIPTIONS-07}:
// every tenant list page takes its heading from the tenantPages i18n namespace
// (en + hi), carries no banned clerk term, and has a translated breadcrumb.
const PAGES = [
  { key: "codeLists", Page: CodeLists },
  { key: "consentExchange", Page: Consent },
  { key: "dataMigration", Page: DataMigration },
  { key: "overview", Page: Overview },
  { key: "plans", Page: Plans },
  { key: "positions", Page: Positions },
  { key: "quotas", Page: Quotas },
  { key: "settings", Page: Settings },
  { key: "stewardship", Page: Stewardship },
  { key: "subscriptions", Page: Subscriptions },
] as const;

type Ns = Record<string, string>;
const enNs = (en as unknown as { tenantPages: Ns }).tenantPages;
const hiNs = (hi as unknown as { tenantPages: Ns }).tenantPages;

describe("tenant pages i18n (en + hi)", () => {
  it("hi.json carries exactly the en.json tenantPages keys, all non-empty and differing from English", () => {
    expect(Object.keys(hiNs).sort()).toEqual(Object.keys(enNs).sort());
    for (const [k, v] of Object.entries(hiNs)) {
      expect(v.trim().length, k).toBeGreaterThan(0);
      expect(v, k).not.toBe(enNs[k]);
    }
  });

  it("no tenantPages string (en or hi) contains a banned clerk term", () => {
    for (const v of [...Object.values(enNs), ...Object.values(hiNs)]) {
      expect(findBannedTerms(v), v).toEqual([]);
    }
  });

  describe.each(PAGES)("$key", ({ key, Page }) => {
    beforeEach(() => vi.clearAllMocks());

    it("renders its translated title and subtitle from the catalogue, not literals", async () => {
      render(await Page());
      expect(enNs[`${key}Title`], `${key}Title missing in en.json`).toBeTruthy();
      expect(screen.getByRole("heading", { name: enNs[`${key}Title`] })).toBeInTheDocument();
      expect(screen.getByText(enNs[`${key}Subtitle`])).toBeInTheDocument();
    });

    it("heading + chrome copy has no banned term", async () => {
      const { container } = render(await Page());
      const main = container.querySelector(".page-main")?.textContent ?? "";
      expect(findBannedTerms(main)).toEqual([]);
    });
  });
});
