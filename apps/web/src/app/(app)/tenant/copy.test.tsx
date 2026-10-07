import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { findBannedTerms } from "@/lib/labels";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// All six list pages read a loader from ../_data. Return a benign empty result
// so the page renders its header (title/subtitle) deterministically.
const empty = () => Promise.resolve({ data: [], source: "api" as const });
vi.mock("../_data", () => ({
  getTenantCodeLists: empty,
  getTenantConsentExchange: empty,
  getTenantDataMigration: empty,
  getTenantOrgHierarchy: empty,
  getTenantOverview: empty,
  getTenantPlans: empty,
}));

import CodeListsPage from "./code-lists/page";
import ConsentPage from "./consent-exchange/page";
import DataMigrationPage from "./data-migration/page";
import OrgHierarchyPage from "./org-hierarchy/page";
import OverviewPage from "./overview/page";
import PlansPage from "./plans/page";

const PAGES: Array<{ gap: string; name: string; Page: () => Promise<JSX.Element> }> = [
  { gap: "CODE-LISTS-06", name: "Code Lists", Page: CodeListsPage },
  { gap: "CONSENT-EXCHANGE-06", name: "Consent Exchange", Page: ConsentPage },
  { gap: "DATA-MIGRATION-06", name: "Data Migration", Page: DataMigrationPage },
  { gap: "ORG-HIERARCHY-06", name: "Org Hierarchy", Page: OrgHierarchyPage },
  { gap: "OVERVIEW-07", name: "Overview", Page: OverviewPage },
  { gap: "PLANS-06", name: "Plans", Page: PlansPage },
];

describe("tenant list pages: clerk-facing copy carries no banned term", () => {
  beforeEach(() => vi.clearAllMocks());

  for (const { gap, name, Page } of PAGES) {
    it(`${gap}: ${name} page heading + breadcrumb use 'Office', not banned jargon`, async () => {
      const { container } = render(await Page());
      const main = container.querySelector(".page-main")?.textContent ?? container.textContent ?? "";
      // No "tenant"/"cross-tenant"/"tenant-service" etc. in the chrome copy.
      expect(findBannedTerms(main)).toEqual([]);
      // Breadcrumb now reads "Office".
      expect(screen.getByRole("link", { name: "Office" })).toHaveAttribute("href", "/tenant");
    });
  }
});
