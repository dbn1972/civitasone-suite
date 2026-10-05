import { describe, it, expect, vi } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import Loading from "./loading";
import ErrorBoundary from "./error";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

// loading.tsx is an async server component that reads copy via getTranslations.
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("@/messages/en.json")).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "en", messages, namespace: namespace as never }),
  };
});

// next/navigation Link is used by RouteError; jsdom renders it as an anchor.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("new opportunity loading/error copy (GAP-CRM-OPPORTUNITIES-NEW-04)", () => {
  it("loading heading matches the page title New Opportunity", async () => {
    render(await Loading());
    expect(screen.getByRole("heading", { name: "New Opportunity" })).toBeInTheDocument();
  });

  it("error boundary names the new opportunity form, not CRM New", () => {
    render(<ErrorBoundary error={new Error("boom")} reset={() => {}} />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toMatch(/new opportunity form/i);
    expect(heading.textContent).not.toMatch(/CRM New/);
  });
});
