/**
 * Root layout — applies to all routes.
 * Theme tokens are injected by theme-service at render time (Vol 7).
 * Tenant context is resolved server-side from JWT claims.
 *
 * UX-004: `lang` and `dir` follow the resolved next-intl locale (cookie ->
 * default "en") instead of being hardcoded. NextIntlClientProvider makes
 * useTranslations()/useLocale() available to client components.
 */
import type { Metadata, Viewport } from "next";
export const viewport: Viewport = { width: "device-width", initialScale: 1 };
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { dirForLocale } from "../i18n/config";
import "@civitasone/ui-kit/tokens.css";
import "./globals.css";
import "./civitas-ds.css";
import "./globals-print.css";

/**
 * UAT-P2-D3 (A11Y-08): the saved theme was applied only when DarkModeToggle
 * mounted inside the (closed) account menu, so every page load reverted to
 * light. This runs before first paint and applies the stored choice
 * (DarkModeToggle's "civitas-theme" key). Storage errors are ignored; no
 * stored value keeps the light default. Nonce'd for the strict script-src CSP.
 */
const THEME_INIT_SCRIPT =
  "(function(){try{var t=localStorage.getItem('civitas-theme');" +
  "if(t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches))" +
  "{document.documentElement.classList.add('dark')}}catch(e){}})();";

async function requestNonce(): Promise<string | undefined> {
  try {
    return (await headers()).get("x-nonce") ?? undefined;
  } catch {
    return undefined; // outside a request (tests, static export)
  }
}

export const metadata: Metadata = {
  title: "CivitasOne Suite",
  description: "Unified Enterprise Suite for Government, PSU, and Small Offices",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const t = await getTranslations("common");
  const nonce = await requestNonce();

  return (
    // suppressHydrationWarning: THEME_INIT_SCRIPT may add class="dark" before React hydrates <html>.
    <html lang={locale} dir={dirForLocale(locale)} suppressHydrationWarning>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {/* First thing parsed in <body>: runs before any content is painted. */}
          <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
          {/* Skip-to-content link: first focusable element on the page (WCAG 2.4.1).
              Targets the <main id="main"> rendered by AppShell. */}
          <a href="#main" className="skip-link">
            {t("skipToContent")}
          </a>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
