import Link from "next/link";
import {
  WifiOff, Languages, Blocks, Lock, Smartphone, MessageSquare, Zap, Plug, Gift,
  Banknote, Users, ShoppingCart, BarChart3, LifeBuoy, Landmark, Search,
  type LucideIcon,
} from "lucide-react";
import { MODULE_COUNT } from "@/app/_data/moduleRegistry";
import { SMALL_OFFICE_LICENSING_LABEL } from "./_data/pricing";

/* ─────────────────────────────────────────────────────────────────────────────
 * CivitasOne Landing Page — Hero, Features, Modules, Comparison, CTA
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * GAP-DASHBOARD-HOME-01: honest, build-time figures instead of a fabricated
 * "33". The module count is derived from the shared MODULE_REGISTRY (the same
 * source the dashboard tiles and Sidebar agree on); the language count is the
 * length of SUPPORTED_LANGUAGES below (the five locales the UI ships). We no
 * longer assert an unsourced "80%+ test coverage".
 */
const SUPPORTED_LANGUAGES = ["English", "Hindi", "Tamil", "Telugu", "Kannada"] as const;
const LANGUAGE_COUNT = SUPPORTED_LANGUAGES.length;

const features: ReadonlyArray<{ Icon: LucideIcon; title: string; desc: string }> = [
  { Icon: WifiOff, title: "Offline-First", desc: "Works without internet. Syncs when connected." },
  { Icon: Languages, title: `${LANGUAGE_COUNT} Languages`, desc: SUPPORTED_LANGUAGES.join(", ") },
  { Icon: Blocks, title: "Modular", desc: "Turn on only what you need. Finance? HR? Both?" },
  { Icon: Lock, title: "Secure", desc: "PKCE auth, encrypted storage, device trust" },
  { Icon: Smartphone, title: "Mobile-First", desc: "Run your office from your phone. No desktop needed." },
  { Icon: MessageSquare, title: "AI Assistant", desc: "Ask questions in plain language. Get step-by-step answers." },
  { Icon: Zap, title: "Sub-Second", desc: "Redis cache-first reads. <200ms P95 response." },
  { Icon: Plug, title: "Extensible", desc: "Plugin SDK for custom integrations. No ABAP." },
  // GAP-DASHBOARD-HOME-03: "Zero Cost" implied all editions are free; the
  // Small Office edition is the open-source/₹0 one (see pricing tiers).
  { Icon: Gift, title: "Open-source core", desc: "Self-host the Small Office edition free, on your own servers." },
] as const;

/**
 * GAP-DASHBOARD-HOME-04: each module links to its docs page (the /docs route
 * exists) via an explicit slug with no spaces, instead of `/#${name}` anchors
 * that matched no id on the page.
 */
const modules: ReadonlyArray<{ Icon: LucideIcon; name: string; slug: string; desc: string }> = [
  { Icon: Banknote, name: "Finance", slug: "finance", desc: "Double-entry, treasury, GST, budgets" },
  { Icon: Users, name: "HR", slug: "hr-payroll", desc: "Leave, attendance, payroll, directory" },
  { Icon: ShoppingCart, name: "Procurement", slug: "procurement", desc: "Indents, POs, vendors, GRN" },
  { Icon: BarChart3, name: "Projects", slug: "projects-grants", desc: "Tasks, milestones, Gantt, timesheets" },
  { Icon: Gift, name: "Grants", slug: "projects-grants", desc: "Utilization certificates, disbursement" },
  { Icon: LifeBuoy, name: "Helpdesk", slug: "citizen-helpdesk", desc: "Tickets, SLA tracking, knowledge base" },
  { Icon: Landmark, name: "Citizen Portal", slug: "citizen-helpdesk", desc: "RTI, grievances, service requests" },
  { Icon: Search, name: "Audit", slug: "admin-settings", desc: "Trail, compliance, observation tracking" },
] as const;

/**
 * GAP-DASHBOARD-HOME-02: the comparison previously asserted unsourced
 * competitor licensing ranges (SAP ₹50L–5Cr, Oracle ₹30L–3Cr) and training
 * hours with no citation — trademark/misrepresentation risk on a
 * government-vendor page. Those rows are removed. What remains are
 * CivitasOne's own, verifiable capability claims; the competitor columns only
 * state capability presence/absence, not fabricated numbers.
 */
const comparison = [
  { feature: "Offline", c1: "✅ Full CRUD", sap: "❌ Read-only", oracle: "❌" },
  { feature: "Licensing/year (Small Office)", c1: "₹0 (open source)", sap: "—", oracle: "—" },
  { feature: "Languages", c1: String(LANGUAGE_COUNT), sap: "1 (without pack)", oracle: "1" },
  { feature: "Mobile-first", c1: "✅", sap: "❌", oracle: "❌" },
  { feature: "eOffice integration", c1: "✅ Native", sap: "❌", oracle: "❌" },
] as const;

const roles = [
  "Office Head",
  "Finance Clerk",
  "HR Officer",
  "Procurement",
  "Citizen",
  "Admin",
] as const;

export default function LandingPage() {
  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-white bg-gradient-to-b from-white to-gray-50">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-28 lg:px-8 lg:py-36">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
                The ERP that works without internet.
              </h1>
              <p className="mt-6 text-lg text-gray-600 sm:text-xl">
                Built for Indian Government, PSU, and Small Offices. Offline-first. Zero training.{" "}
                {SMALL_OFFICE_LICENSING_LABEL} (open source).
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <Link
                  href="/sandbox"
                  className="inline-flex items-center rounded-lg bg-gray-900 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-gray-800 transition-colors"
                >
                  Try the Sandbox →
                </Link>
                <Link
                  href="/pricing"
                  className="inline-flex items-center rounded-lg border border-gray-300 px-6 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  See editions
                </Link>
              </div>
            </div>
            {/* Hero visual */}
            <div className="relative mx-auto w-full max-w-md lg:max-w-none">
              <div className="rounded-2xl bg-gray-900 bg-gradient-to-br from-gray-900 to-gray-700 p-8 text-white shadow-2xl">
                {/*
                  GAP-DASHBOARD-HOME-01: this card is static copy, so it must
                  not pose as "Live System Stats" with a pulsing green status
                  dot. The figures are now build-time constants (module count
                  from the shared registry, language count from the locale
                  list); the unsourced "80%+ test coverage" figure is removed.
                */}
                <div className="mb-4 flex items-center gap-2 text-sm text-gray-300">At a glance</div>
                <div className="grid grid-cols-2 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold sm:text-3xl" data-testid="stat-modules">{MODULE_COUNT}</div>
                    <div className="mt-1 text-xs text-gray-400">modules</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold sm:text-3xl" data-testid="stat-languages">{LANGUAGE_COUNT}</div>
                    <div className="mt-1 text-xs text-gray-400">languages</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Trust Bar ────────────────────────────────────────────────────── */}
      <section className="border-y border-gray-100 bg-white py-10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-8 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Built for</p>
              <div className="mt-3 flex flex-wrap gap-3">
                {["Government of India", "PSU", "Small Office"].map((b) => (
                  <span key={b} className="rounded-full bg-gray-100 px-4 py-1.5 text-sm font-medium text-gray-700">
                    {b}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Compliant with</p>
              <div className="mt-3 flex flex-wrap gap-3">
                {["DPDP Act", "GFR 2017", "GST", "CERT-In"].map((b) => (
                  <span key={b} className="rounded-full bg-blue-50 px-4 py-1.5 text-sm font-medium text-blue-700">
                    {b}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Feature Grid ─────────────────────────────────────────────────── */}
      <section id="features" className="bg-white py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-gray-900 sm:text-4xl">Everything you need, nothing you don't</h2>
            <p className="mt-4 text-lg text-gray-500">No bloat. No training manuals. No vendor lock-in.</p>
          </div>
          <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3" data-testid="feature-grid">
            {features.map(({ Icon, title, desc }) => (
              <div key={title} className="rounded-xl border border-gray-100 p-6 hover:shadow-md transition-shadow">
                <Icon aria-hidden="true" className="h-7 w-7 text-gray-900" />
                <h3 className="mt-4 text-lg font-semibold text-gray-900">{title}</h3>
                <p className="mt-2 text-sm text-gray-500">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Modules Showcase ─────────────────────────────────────────────── */}
      <section id="modules" className="bg-gray-50 py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-gray-900 sm:text-4xl">{MODULE_COUNT} modules. Turn on what you need.</h2>
          <p className="mt-4 text-lg text-gray-500">Here are the most popular ones.</p>
          <div className="mt-12 flex gap-6 overflow-x-auto pb-4 scrollbar-thin" data-testid="modules-strip">
            {modules.map(({ Icon, name, slug, desc }) => (
              <div
                key={name}
                className="flex-none w-64 rounded-xl border border-gray-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
              >
                <Icon aria-hidden="true" className="h-7 w-7 text-gray-900" />
                <h3 className="mt-3 font-semibold text-gray-900">{name}</h3>
                <p className="mt-2 text-sm text-gray-500">{desc}</p>
                <Link href={`/docs/${slug}`} className="mt-4 inline-block text-sm font-medium text-gray-900 hover:text-gray-600">
                  Learn more →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Documentation CTA ────────────────────────────────────────────── */}
      <section className="bg-white py-20 sm:py-28">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="text-3xl font-bold text-gray-900 sm:text-4xl">
            Full Documentation Available
          </h2>
          <p className="mt-4 text-lg text-gray-500">
            Step-by-step guides for every module. Written for office staff with no IT background.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            {/*
              GAP-DASHBOARD-HOME-06: the "Download PDF" link pointed at
              /docs/CivitasOne-User-Manual.pdf, which does not exist under
              apps/web/public/docs (only an api/ folder and a README). Rather
              than ship a dead download, we direct users to the online docs,
              which are present and maintained. If a signed PDF manual is
              produced later, re-add a link pointing at the real asset.
            */}
            <Link
              href="/docs"
              className="inline-flex items-center rounded-lg bg-gray-900 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-gray-800 transition-colors"
            >
              Read Online →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Comparison Table ──────────────────────────────────────────────── */}
      <section className="bg-white py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-gray-900 sm:text-4xl">How we compare</h2>
          <p className="mt-4 text-lg text-gray-500">CivitasOne vs legacy ERPs on the capabilities that matter.</p>
          <div className="mt-12 overflow-x-auto">
            <table className="w-full min-w-[600px] text-start text-sm" data-testid="comparison-table">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="py-3 pe-4 font-semibold text-gray-900">Feature</th>
                  <th className="py-3 pe-4 font-semibold text-gray-900">CivitasOne</th>
                  <th className="py-3 pe-4 font-semibold text-gray-500">SAP</th>
                  <th className="py-3 font-semibold text-gray-500">Oracle</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((row) => (
                  <tr key={row.feature} className="border-b border-gray-100">
                    <td className="py-3 pe-4 font-medium text-gray-700">{row.feature}</td>
                    <td className="py-3 pe-4 text-gray-900">{row.c1}</td>
                    <td className="py-3 pe-4 text-gray-500">{row.sap}</td>
                    <td className="py-3 text-gray-500">{row.oracle}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-4 text-xs text-gray-400">
              Comparison reflects CivitasOne&apos;s own capabilities. Competitor capabilities shown are indicative; verify against the vendor&apos;s current documentation.
            </p>
          </div>
        </div>
      </section>

      {/* ── Sandbox CTA ──────────────────────────────────────────────────── */}
      <section className="bg-gray-50 bg-gradient-to-b from-gray-50 to-white py-20 sm:py-28">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="text-3xl font-bold text-gray-900 sm:text-4xl">
            See it yourself. No sign-up required.
          </h2>
          <p className="mt-4 text-lg text-gray-500">
            Explore a fully loaded demo environment with realistic data.
          </p>
          <Link
            href="/sandbox"
            className="mt-8 inline-flex items-center rounded-lg bg-gray-900 px-8 py-4 text-base font-semibold text-white shadow-lg hover:bg-gray-800 transition-colors"
          >
            Open Sandbox →
          </Link>
          <div className="mt-10">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Choose a role</p>
            {/*
              GAP-DASHBOARD-HOME-05: the role "chips" used to be plain <span>s
              styled like interactive pills that led nowhere. They are now
              keyboard-focusable links into the sandbox (which has a role
              picker), so the affordance matches the behaviour.
            */}
            <div className="mt-4 flex flex-wrap justify-center gap-3" data-testid="role-chips">
              {roles.map((role) => (
                <Link
                  key={role}
                  href="/sandbox"
                  className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
                >
                  {role}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
