import { describe, it, expect } from "vitest";
import en from "./en.json";
import hi from "./hi.json";

// GAP-CRM-FORECAST-06: the CRM hub's tile for /crm/deals, the board and the forecast stat tiles
// all call the thing a vendor/stakeholder pursuit is tracked as an "Engagement" (Hindi
// "सहभागिता"). The forecast's period strings still said "deal(s)". Scoped to the forecast
// namespace only: the wider Deal-vs-Engagement choice (CRM hub tile descriptions, /crm/deals/new,
// ...) is an open product decision (GAP-CRM-DEALS-NEW-07) and is deliberately NOT pre-empted here.
const DEAL = /\bdeals?\b|डील|सौदे|सौदा/i;

describe("forecast wording uses the CRM's 'engagement' noun (GAP-CRM-FORECAST-06)", () => {
  for (const [locale, messages] of [["en", en], ["hi", hi]] as const) {
    it(`${locale}: no forecast period string says "deal"`, () => {
      const offenders = Object.entries(messages.crmForecastPeriod).filter(([, v]) => typeof v === "string" && DEAL.test(v));
      expect(offenders).toEqual([]);
    });
  }

  it("the default-horizon option and suffix name engagements, in both locales", () => {
    expect(en.crmForecastPeriod.allOpenEngagements).toBe("all open engagements");
    expect(en.crmForecastPeriod.allOpenEngagementsOption).toBe("All open engagements");
    // The hub's own Hindi word for the same thing.
    expect(hi.crmForecastPeriod.allOpenEngagements).toContain("सहभागिता");
    expect(hi.crm.hub.tiles.deals.description).toContain("सहभागिता");
  });

  it("agrees with the CRM hub tile that links to the deals/engagements list", () => {
    expect(en.crm.hub.tiles.deals.title).toMatch(/Engagements/);
  });
});
