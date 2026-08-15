/**
 * Root layout — applies to all routes.
 * Theme tokens are injected by theme-service at render time (Vol 7).
 * Tenant context is resolved server-side from JWT claims.
 */
import type { Metadata, Viewport } from "next";
export const viewport: Viewport = { width: "device-width", initialScale: 1 };
import "@civitasone/ui-kit/tokens.css";
import "./globals.css";
import "./civitas-ds.css";
import "./globals-print.css";

export const metadata: Metadata = {
  title: "CivitasOne Suite",
  description: "Unified Enterprise Suite for Government, PSU, and Small Offices",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Skip-to-content link: first focusable element on the page (WCAG 2.4.1).
            Targets the <main id="main"> rendered by AppShell. */}
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
