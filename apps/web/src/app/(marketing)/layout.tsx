import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "CivitasOne — The ERP that works without internet",
  description:
    "Built for Indian Government, PSU, and Small Offices. Offline-first. Zero training. ₹0 licensing.",
};

function NavBar() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-gray-100 bg-white/80 backdrop-blur-md">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold text-gray-900">
          <span className="text-2xl">◈</span> CivitasOne
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
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/sandbox"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Try Sandbox
          </Link>
          <Link
            href="/auth/login"
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
          >
            Sign In
          </Link>
        </div>
      </nav>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-gray-100 bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4 lg:grid-cols-6">
          <div className="col-span-2">
            <Link href="/" className="flex items-center gap-2 text-lg font-bold text-gray-900">
              <span className="text-2xl">◈</span> CivitasOne
            </Link>
            <p className="mt-3 text-sm text-gray-500">
              Made in India 🇮🇳 for India
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Product</h3>
            <ul className="mt-3 space-y-2">
              <li><Link href="/#features" className="text-sm text-gray-500 hover:text-gray-700">Features</Link></li>
              <li><Link href="/#modules" className="text-sm text-gray-500 hover:text-gray-700">Modules</Link></li>
              <li><Link href="/pricing" className="text-sm text-gray-500 hover:text-gray-700">Pricing</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Resources</h3>
            <ul className="mt-3 space-y-2">
              <li><Link href="/docs" className="text-sm text-gray-500 hover:text-gray-700">Documentation</Link></li>
              <li><Link href="/docs/api" className="text-sm text-gray-500 hover:text-gray-700">API</Link></li>
              <li><Link href="https://github.com/civitasone" className="text-sm text-gray-500 hover:text-gray-700">GitHub</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Company</h3>
            <ul className="mt-3 space-y-2">
              <li><Link href="/contact" className="text-sm text-gray-500 hover:text-gray-700">Contact</Link></li>
              <li><Link href="/careers" className="text-sm text-gray-500 hover:text-gray-700">Careers</Link></li>
            </ul>
          </div>
        </div>
        <div className="mt-12 border-t border-gray-200 pt-8 text-center text-sm text-gray-400">
          © 2026 CivitasOne. All rights reserved.
        </div>
      </div>
    </footer>
  );
}

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <NavBar />
      <main id="main">{children}</main>
      <Footer />
    </div>
  );
}
