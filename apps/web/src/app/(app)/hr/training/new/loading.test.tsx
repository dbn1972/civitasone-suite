import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import Loading from "./loading";

/**
 * GAP-HR-TRAINING-NEW-04: structural "visual" check that the loading state
 * resembles the form it stands in for (a single column of field rows plus a
 * submit bar inside a card) and no longer the dashboard-shaped legacy
 * skeleton (.ph header + hero box + stat tiles + table).
 */
describe("training/new loading skeleton", () => {
  it("is form-shaped: a card of field rows and a submit bar, no dashboard blocks", async () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {await Loading()}
      </NextIntlClientProvider>,
    );
    expect(container.querySelector(".card")).not.toBeNull();
    // title, venue, from/to, facilitator, max participants, category/mode, deadline
    expect(container.querySelectorAll('[data-skeleton="field"]')).toHaveLength(9);
    expect(container.querySelectorAll('[data-skeleton="submit"]')).toHaveLength(1);
    // legacy dashboard-shaped skeleton markers are gone
    expect(container.querySelector(".ph")).toBeNull();
    expect(container.querySelector(".stat")).toBeNull();
    expect(container.querySelector("table")).toBeNull();
  });

  it("announces itself with the i18n region label (English)", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {await Loading()}
      </NextIntlClientProvider>,
    );
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(region).toHaveAccessibleName("Loading new training program form");
  });

  it("uses the Hindi region label for the Hindi locale", () => {
    // The shared next-intl/server mock is English-only, so assert the Hindi
    // string the real request config would resolve for this key directly.
    expect(hiMessages.trainingNew.loadingAriaLabel).toBe("नया प्रशिक्षण कार्यक्रम फ़ॉर्म लोड हो रहा है");
    expect(hiMessages.trainingNew.loadingAriaLabel).not.toBe(enMessages.trainingNew.loadingAriaLabel);
  });
});
