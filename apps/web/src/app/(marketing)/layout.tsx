import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { MobileNav } from "./MobileNav";
import { SiteFooterGigwLinks, SiteFooterIdentity } from "./_gigw/SiteFooterGigw";

export const metadata: Metadata = {
  title: "CivitasOne — The ERP that works without internet",
  description:
    "Built for Indian Government, PSU, and Small Offices. Offline-first. Zero training. ₹0 licensing for Small Office.",
};

function NavBar() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-gray-100 bg-white/80 backdrop-blur-md">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold text-gray-900">
          <span className="text-2xl" aria-hidden="true">◈</span> CivitasOne
        </Link>

        <div className="hidden items-center gap-6 md:flex">
          <Link href="/#features" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
            Products
          </Link>
          <Link href="/pricing" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
            Pricing
          </Link>
          <Link href="/docs" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
            Docs
          </Link>
          <Link href="/contact" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
            Contact
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/contact"
            className="hidden rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors md:inline-block"
          >
            Contact sales
          </Link>
          {/* WCAG 1.4.10 (UAT gigw-content): at 320 px the header was 352 px wide
              (horizontal scroll on every public page); below sm the sandbox
              link moves into the mobile menu. */}
          <Link
            href="/sandbox"
            className="hidden rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors sm:inline-block"
          >
            Try Sandbox
          </Link>
          <Link
            href="/auth/login"
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
          >
            Sign In
          </Link>
          <MobileNav />
        </div>
      </nav>
    </header>
  );
}

// A-N1 (UAT post-b14, WCAG 1.4.3): the footer text colours were Tailwind
// literals; the copyright line (text-gray-400 on gray-50) was 2.42:1 on every
// public page. They are now the footer design tokens (.site-foot*, civitas-ds.css),
// pinned to their light values on this light-only surface.
function Footer() {
  return (
    <footer className="site-foot">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4 lg:grid-cols-6">
          <div className="col-span-2">
            <Link href="/" className="site-foot-heading flex items-center gap-2 text-lg font-bold">
              <span className="text-2xl" aria-hidden="true">◈</span> CivitasOne
            </Link>
            <p className="mt-3 text-sm">
              Made in India 🇮🇳 for India
            </p>
          </div>
          <div>
            <h3 className="site-foot-heading text-sm font-semibold">Product</h3>
            <ul className="mt-3 space-y-2">
              <li><Link href="/#features" className="text-sm">Features</Link></li>
              <li><Link href="/#modules" className="text-sm">Modules</Link></li>
              <li><Link href="/pricing" className="text-sm">Pricing</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="site-foot-heading text-sm font-semibold">Resources</h3>
            <ul className="mt-3 space-y-2">
              <li><Link href="/docs" className="text-sm">Documentation</Link></li>
              <li><Link href="/docs/api" className="text-sm">API</Link></li>
              <li><Link href="https://github.com/civitasone" className="text-sm">GitHub</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="site-foot-heading text-sm font-semibold">Company</h3>
            <ul className="mt-3 space-y-2">
              <li><Link href="/contact" className="text-sm">Contact</Link></li>
              <li><Link href="/careers" className="text-sm">Careers</Link></li>
            </ul>
          </div>
          <SiteFooterGigwLinks />
        </div>
        <div className="site-foot-rule mt-12 pt-8 text-center text-sm">
          © 2026 CivitasOne. All rights reserved.
          <SiteFooterIdentity />
        </div>
      </div>
    </footer>
  );
}

export default function MarketingLayout({ children }: { children: ReactNode }) {
  // GAP-PRICING-HOME-05 decision: the marketing site uses a single, consistent
  // light Tailwind palette by design (the landing, pricing, sandbox and docs
  // pages all share it) and has no dark: variants. Rather than invent a
  // half-done dark theme, the marketing surface is explicitly declared
  // light-only via `color-scheme: light`, so a user agent in dark mode will
  // not auto-invert form controls / scrollbars and render it illegibly.
  return (
    <div className="min-h-screen bg-white [color-scheme:light]" data-color-scheme="light">
      <NavBar />
      <main id="main">{children}</main>
      <Footer />
    </div>
  );
}
