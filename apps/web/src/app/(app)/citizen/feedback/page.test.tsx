import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// next-intl/server throws in plain jsdom (see grievances/page.test.tsx note);
// mock it with a real-en.json-backed dot-path lookup for this server component.
vi.mock("next-intl/server", async () => {
  const messages = (await import("@/messages/en.json")).default as Record<string, unknown>;
  function resolve(obj: unknown, dotted: string): unknown {
    return dotted.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);
  }
  function makeT(namespace?: string) {
    const scope = namespace ? resolve(messages, namespace) : messages;
    return (key: string) => {
      const found = resolve(scope, key);
      return typeof found === "string" ? found : key;
    };
  }
  return {
    getTranslations: async (namespace?: string) => makeT(namespace),
    getLocale: async () => "en",
    getMessages: async () => messages,
  };
});

import CitizenFeedbackPage from "./page";

async function renderPage(page: Promise<React.ReactElement>) {
  const ui = await page;
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("CitizenFeedbackPage (GAP-CITIZEN-FEEDBACK-01/02/04)", () => {
  it("shows plain-language copy, not internal 'feedback module' wording", async () => {
    await renderPage(CitizenFeedbackPage());
    expect(screen.getByText(/Online feedback submission isn't available yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/feedback module is enabled/i)).not.toBeInTheDocument();
  });

  it("offers an action linking to a real, backed route (Grievances)", async () => {
    const { container } = await renderPage(CitizenFeedbackPage());
    const link = container.querySelector('a[href="/citizen/grievances"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toMatch(/Grievances/i);
  });

  it("renders inside a ds Card (card shell present)", async () => {
    const { container } = await renderPage(CitizenFeedbackPage());
    expect(container.querySelector(".card")).not.toBeNull();
  });
});
