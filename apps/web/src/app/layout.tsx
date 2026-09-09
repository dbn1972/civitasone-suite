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
import { dirForLocale } from "../i18n/config";
import "@civitasone/ui-kit/tokens.css";
import "./globals.css";
import "./civitas-ds.css";
import "./globals-print.css";

export const metadata: Metadata = {
  title: "CivitasOne Suite",
  description: "Unified Enterprise Suite for Government, PSU, and Small Offices",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const t = await getTranslations("common");

  return (
    <html lang={locale} dir={dirForLocale(locale)}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
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
