import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import enMessages from "../messages/en.json";
import hiMessages from "../messages/hi.json";

// RootLayout (src/app/layout.tsx) resolves the locale via next-intl/server's
// getLocale()/getMessages(), which in production read the `locale` cookie
// through src/i18n/request.ts. Mocking next-intl/server directly (rather than
// next/headers) keeps this test focused on UX-004's actual fix: that
// layout.tsx uses the resolved locale for `lang`/`dir` instead of a
// hardcoded "en" — see the sabotage-check note below.
const getLocaleMock = vi.fn();
const getMessagesMock = vi.fn();
vi.mock("next-intl/server", () => ({
  getLocale: () => getLocaleMock(),
  getMessages: () => getMessagesMock(),
  // layout.tsx also translates its skip-link via the "common" namespace —
  // resolve it from whatever messages the test's getMessagesMock returns.
  getTranslations: async (namespace: string) => {
    const messages = await getMessagesMock();
    return (key: string) => messages[namespace]?.[key] ?? key;
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function GrievancesTitleProbe() {
  const t = useTranslations("grievances");
  return <span data-testid="probe">{t("title")}</span>;
}

describe("RootLayout locale resolution (UX-004)", () => {
  it("renders <html lang> and dir for the English locale", async () => {
    getLocaleMock.mockResolvedValue("en");
    getMessagesMock.mockResolvedValue(enMessages);

    const { default: RootLayout } = await import("./layout");
    const element = await RootLayout({ children: <div /> });

    // SABOTAGE-CHECK TARGET: if layout.tsx reverts to a hardcoded
    // `<html lang="en">`, this assertion for "hi" below fails, but this one
    // stays green — the real proof is the "hi" case, not this one.
    expect(element.type).toBe("html");
    expect(element.props.lang).toBe("en");
    expect(element.props.dir).toBe("ltr");
  });

  it("renders <html lang=\"hi\"> when the resolved locale is Hindi — fails if layout.tsx hardcodes \"en\"", async () => {
    getLocaleMock.mockResolvedValue("hi");
    getMessagesMock.mockResolvedValue(hiMessages);

    const { default: RootLayout } = await import("./layout");
    const element = await RootLayout({ children: <div /> });

    expect(element.props.lang).toBe("hi");
  });

  it("re-renders a first-tranche translated string (grievances.title) in the switched locale", async () => {
    // Walk the real element tree RootLayout returns (html > body >
    // NextIntlClientProvider) to pull out exactly the locale/messages it
    // resolved, without rendering <html>/<body> into jsdom directly.
    function extractProviderProps(rootElement: any) {
      const body = rootElement.props.children;
      const provider = body.props.children;
      return { locale: provider.props.locale, messages: provider.props.messages };
    }

    // English pass
    getLocaleMock.mockResolvedValue("en");
    getMessagesMock.mockResolvedValue(enMessages);
    const { default: RootLayoutEn } = await import("./layout");
    const enElement = await RootLayoutEn({ children: <div /> });
    const en = extractProviderProps(enElement);
    expect(en.locale).toBe("en");
    render(
      <NextIntlClientProvider locale={en.locale} messages={en.messages}>
        <GrievancesTitleProbe />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("Grievances");
    cleanup();

    // Switched to Hindi
    getLocaleMock.mockResolvedValue("hi");
    getMessagesMock.mockResolvedValue(hiMessages);
    const { default: RootLayoutHi } = await import("./layout");
    const hiElement = await RootLayoutHi({ children: <div /> });
    const hi = extractProviderProps(hiElement);
    expect(hi.locale).toBe("hi");
    render(
      <NextIntlClientProvider locale={hi.locale} messages={hi.messages}>
        <GrievancesTitleProbe />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("शिकायतें");
  });
});

describe("NextIntlClientProvider wiring sanity", () => {
  it("useTranslations reflects whatever locale/messages layout.tsx resolved", () => {
    render(
      <NextIntlClientProvider locale="hi" messages={hiMessages}>
        <GrievancesTitleProbe />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("शिकायतें");
  });
});
