import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// jsdom lacks matchMedia; components reading prefers-color-scheme need it
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}

afterEach(() => {
  cleanup();
});

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));

// Mock next/link as a plain anchor (factory returns a module)
vi.mock("next/link", () => {
  const Link = (props: Record<string, unknown>) => {
    const { children, href, ...rest } = props;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = require("react").createElement("a", { href, ...rest }, children);
    return h;
  };
  return { default: Link, __esModule: true };
});

// Mock next/headers
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: vi.fn(() => undefined),
    set: vi.fn(),
    delete: vi.fn(),
  }),
  headers: () => new Map(),
}));

// Mock next-intl/server (UX-017): Vitest/jsdom never sets the "react-server"
// resolve condition next-intl gates its real server implementation behind,
// so an unmocked getTranslations() throws "`getTranslations` is not
// supported in Client Components" the instant any async Server Component
// page.tsx calls it -- surfaced by the first UX-017 tranche to translate a
// server-component page that also has a direct `render(await Page())` unit
// test (earlier tranches only touched "use client" pages, which sidestep
// this by wrapping renders in NextIntlClientProvider instead). Rebuilt here
// on next-intl's own createTranslator (not gated behind react-server) so
// ICU interpolation/plurals/t.rich() behave exactly like production --
// always in English, matching the locale="en" NextIntlClientProvider
// wrapping already used for client-component tests.
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const enMessages = (await import("./src/messages/en.json")).default;
  return {
    getTranslations: async (arg?: string | { namespace?: string }) => {
      const namespace = typeof arg === "string" ? arg : arg?.namespace;
      // next-intl infers a large namespace-key union from the real messages
      // shape for production type safety; a test mock's dynamically-typed
      // `namespace` string can't satisfy that literal union, so it's cast
      // to the createTranslator parameter type here rather than widening
      // (and so losing) that type safety for real call sites.
      return createTranslator({ locale: "en", messages: enMessages, namespace } as Parameters<typeof createTranslator>[0]);
    },
    getLocale: async () => "en",
    getMessages: async () => enMessages,
  };
});
