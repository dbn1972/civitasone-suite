"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * Mobile navigation disclosure for the marketing header (GAP-CONTACT-HOME-04).
 *
 * The desktop nav is `hidden md:flex`, so below 768px there were previously no nav
 * links and no menu button at all. This renders a hamburger (shown only `md:hidden`)
 * that toggles a panel exposing every primary link, including Contact.
 */
const LINKS = [
  { href: "/#features", label: "Products" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
  { href: "/contact", label: "Contact" },
] as const;

export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label="Toggle navigation menu"
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
      >
        <span aria-hidden="true" className="text-xl">
          {open ? "✕" : "☰"}
        </span>
      </button>
      {open && (
        <div
          id="mobile-nav-panel"
          className="absolute left-0 right-0 top-full border-b border-gray-100 bg-white shadow-sm"
        >
          <nav className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3 sm:px-6">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </div>
  );
}
