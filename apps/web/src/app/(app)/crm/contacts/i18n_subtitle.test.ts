import { describe, it, expect } from "vitest";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

/**
 * GAP-CRM-ACCOUNTS-07: Devanagari literals removed from subtitle strings.
 * Given locale=en the subtitle must contain no Devanagari.
 * Given locale=hi the subtitle must contain the Hindi string.
 */
describe("GAP-CRM-ACCOUNTS-07 — subtitle i18n", () => {
  it("crmContactsPage.subtitle has no Devanagari in English locale", () => {
    const subtitle = (enMessages as unknown as Record<string, Record<string, string>>)["crmContactsPage"]?.subtitle ?? "";
    // No Devanagari Unicode block (U+0900–U+097F)
    expect(subtitle).not.toMatch(/[\u0900-\u097F]/);
  });

  it("crmDealsPage.subtitle has no Devanagari in English locale", () => {
    const subtitle = (enMessages as unknown as Record<string, Record<string, string>>)["crmDealsPage"]?.subtitle ?? "";
    expect(subtitle).not.toMatch(/[\u0900-\u097F]/);
  });

  it("crmContactsPage.subtitle is defined in Hindi locale and contains Devanagari", () => {
    const subtitle = (hiMessages as unknown as Record<string, Record<string, string>>)["crmContactsPage"]?.subtitle ?? "";
    expect(subtitle.length).toBeGreaterThan(0);
    expect(subtitle).toMatch(/[\u0900-\u097F]/);
  });

  it("crmDealsPage.subtitle is defined in Hindi locale and contains Devanagari", () => {
    const subtitle = (hiMessages as unknown as Record<string, Record<string, string>>)["crmDealsPage"]?.subtitle ?? "";
    expect(subtitle.length).toBeGreaterThan(0);
    expect(subtitle).toMatch(/[\u0900-\u097F]/);
  });
});
