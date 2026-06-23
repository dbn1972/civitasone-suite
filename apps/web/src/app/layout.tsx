/**
 * Root layout — applies to all routes.
 * Theme tokens are injected by theme-service at render time (Vol 7).
 * Tenant context is resolved server-side from JWT claims.
 */
import type { Metadata } from "next";
import "@civitasone/ui-kit/tokens.css";
import "./globals.css";
import "./civitas-ds.css";

export const metadata: Metadata = {
  title: "CivitasOne Suite",
  description: "Unified Enterprise Suite for Government, PSU, and Small Offices",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
