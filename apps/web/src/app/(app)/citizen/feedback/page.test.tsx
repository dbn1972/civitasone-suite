import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next-intl/server", async () => {
  const messages = (await import("@/messages/en.json")).default as Record<string, unknown>;
  function resolve(obj: unknown, dotted: string): unknown {
    return dotted.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);
  }
  return {
    getTranslations: async (namespace?: string) => (key: string) => {
      const found = resolve(namespace ? resolve(messages, namespace) : messages, key);
      return typeof found === "string" ? found : key;
    },
    getLocale: async () => "en",
    getMessages: async () => messages,
  };
});

import CitizenFeedbackPage from "./page";

describe("CitizenFeedbackPage (D3 CITIZEN-FEEDBACK-03)", () => {
  it("points feedback at the existing citizen surveys module (no new endpoint)", async () => {
    const ui = await CitizenFeedbackPage();
    const { container } = render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
    const link = container.querySelector('a[href="/citizen/surveys"]');
    expect(link).not.toBeNull();
    expect(screen.getByText(enMessages.citizenFeedback.movedTitle)).toBeInTheDocument();
  });
});
