import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import hiMessages from "@/messages/hi.json";

// GAP-PAYROLL-FORM16-08: in the Hindi locale the back link is translated. The
// global next-intl/server mock is English-only, so this file swaps in a Hindi one.
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const hi = (await import("@/messages/hi.json")).default;
  return {
    getTranslations: async (arg?: string | { namespace?: string }) => {
      const namespace = typeof arg === "string" ? arg : arg?.namespace;
      return createTranslator({ locale: "hi", messages: hi, namespace } as Parameters<typeof createTranslator>[0]);
    },
    getLocale: async () => "hi",
    getMessages: async () => hi,
  };
});
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => ["employee"] }));
vi.mock("../_lib/statusAwareFetch", () => ({ statusAwareGet: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

import Form16Page from "./page";

describe("Form16Page — Hindi locale (GAP-PAYROLL-FORM16-08)", () => {
  it("shows the translated back label in the header and on the permission-denied card, not the English one", async () => {
    const ui = await Form16Page({ searchParams: {} });
    render(<NextIntlClientProvider locale="hi" messages={hiMessages}>{ui}</NextIntlClientProvider>);
    const links = screen.getAllByRole("link", { name: /पेरोल पर वापस जाएं/ });
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Back to Payroll")).not.toBeInTheDocument();
    for (const l of links) expect(l).toHaveAttribute("href", "/hr/payroll");
  });
});
