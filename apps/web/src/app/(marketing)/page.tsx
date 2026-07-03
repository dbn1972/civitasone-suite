import Link from "next/link";

/* ─────────────────────────────────────────────────────────────────────────────
 * CivitasOne Landing Page — Hero, Features, Modules, Comparison, CTA
 * ────────────────────────────────────────────────────────────────────────── */

const features = [
  { icon: "📴", title: "Offline-First", desc: "Works without internet. Syncs when connected." },
  { icon: "🇮🇳", title: "5 Languages", desc: "English, Hindi, Tamil, Telugu, Kannada" },
  { icon: "🧩", title: "Modular", desc: "Turn on only what you need. Finance? HR? Both?" },
  { icon: "🔒", title: "Secure", desc: "PKCE auth, encrypted storage, device trust" },
  { icon: "📱", title: "Mobile-First", desc: "Run your office from your phone. No desktop needed." },
  { icon: "💬", title: "AI Assistant", desc: "Ask questions in plain language. Get step-by-step answers." },
  { icon: "⚡", title: "Sub-Second", desc: "Redis cache-first reads. <200ms P95 response." },
  { icon: "🔌", title: "Extensible", desc: "Plugin SDK for custom integrations. No ABAP." },
  { icon: "🆓", title: "Zero Cost", desc: "Open-source. Self-host on your own servers." },
] as const;

const modules = [
  { icon: "💰", name: "Finance", desc: "Double-entry, treasury, GST, budgets" },
  { icon: "👥", name: "HR", desc: "Leave, attendance, payroll, directory" },
  { icon: "🛒", name: "Procurement", desc: "Indents, POs, vendors, GRN" },
  { icon: "📋", name: "Projects", desc: "Tasks, milestones, Gantt, timesheets" },
  { icon: "🏦", name: "Grants", desc: "Utilization certificates, disbursement" },
  { icon: "🎫", name: "Helpdesk", desc: "Tickets, SLA tracking, knowledge base" },
  { icon: "🏛️", name: "Citizen Portal", desc: "RTI, grievances, service requests" },
  { icon: "🔍", name: "Audit", desc: "Trail, compliance, observation tracking" },
] as const;

const comparison = [
  { feature: "Offline", c1: "✅ Full CRUD", sap: "❌ Read-only", oracle: "❌" },
  { feature: "Licensing/year", c1: "₹0", sap: "₹50L–5Cr", oracle: "₹30L–3Cr" },
  { feature: "Training needed", c1: "0 hours", sap: "40+ hours", oracle: "40+ hours" },
  { feature: "Languages", c1: "5", sap: "1 (without pack)", oracle: "1" },
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
      <section className="relative overflow-hidden bg-gradient-to-b from-white to-gray-50">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-28 lg:px-8 lg:py-36">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
                The ERP that works without internet.
              </h1>
              <p className="mt-6 text-lg text-gray-600 sm:text-xl">
                Built for Indian Government, PSU, and Small Offices. Offline-first. Zero training. ₹0 licensing.
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
                  View Pricing
                </Link>
              </div>
            </div>
            {/* Hero visual */}
            <div className="relative mx-auto w-full max-w-md lg:max-w-none">
              <div className="rounded-2xl bg-gradient-to-br from-gray-900 to-gray-700 p-8 text-white shadow-2xl">
                <div className="mb-4 flex items-center gap-2 text-sm text-gray-300">
                  <span className="inline-block h-2 w-2 rounded-full bg-green-400" />
                  Live System Stats
                </div>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold sm:text-3xl">33</div>
                    <div className="mt-1 text-xs text-gray-400">modules</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold sm:text-3xl">5</div>
                    <div className="mt-1 text-xs text-gray-400">languages</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold sm:text-3xl">80%+</div>
                    <div className="mt-1 text-xs text-gray-400">test coverage</div>
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
            {features.map((f) => (
              <div key={f.title} className="rounded-xl border border-gray-100 p-6 hover:shadow-md transition-shadow">
                <div className="text-3xl">{f.icon}</div>
                <h3 className="mt-4 text-lg font-semibold text-gray-900">{f.title}</h3>
                <p className="mt-2 text-sm text-gray-500">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Modules Showcase ─────────────────────────────────────────────── */}
      <section id="modules" className="bg-gray-50 py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-gray-900 sm:text-4xl">33 modules. Turn on what you need.</h2>
          <p className="mt-4 text-lg text-gray-500">Here are the most popular ones.</p>
          <div className="mt-12 flex gap-6 overflow-x-auto pb-4 scrollbar-thin" data-testid="modules-strip">
            {modules.map((m) => (
              <div
                key={m.name}
                className="flex-none w-64 rounded-xl border border-gray-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="text-3xl">{m.icon}</div>
                <h3 className="mt-3 font-semibold text-gray-900">{m.name}</h3>
                <p className="mt-2 text-sm text-gray-500">{m.desc}</p>
                <Link href={`/#${m.name.toLowerCase()}`} className="mt-4 inline-block text-sm font-medium text-gray-900 hover:text-gray-600">
                  Learn more →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Comparison Table ──────────────────────────────────────────────── */}
      <section className="bg-white py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-gray-900 sm:text-4xl">How we compare</h2>
          <p className="mt-4 text-lg text-gray-500">CivitasOne vs legacy ERPs — no contest.</p>
          <div className="mt-12 overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-sm" data-testid="comparison-table">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="py-3 pr-4 font-semibold text-gray-900">Feature</th>
                  <th className="py-3 pr-4 font-semibold text-gray-900">CivitasOne</th>
                  <th className="py-3 pr-4 font-semibold text-gray-500">SAP</th>
                  <th className="py-3 font-semibold text-gray-500">Oracle</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((row) => (
                  <tr key={row.feature} className="border-b border-gray-100">
                    <td className="py-3 pr-4 font-medium text-gray-700">{row.feature}</td>
                    <td className="py-3 pr-4 text-gray-900">{row.c1}</td>
                    <td className="py-3 pr-4 text-gray-500">{row.sap}</td>
                    <td className="py-3 text-gray-500">{row.oracle}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Sandbox CTA ──────────────────────────────────────────────────── */}
      <section className="bg-gradient-to-b from-gray-50 to-white py-20 sm:py-28">
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
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              {roles.map((role) => (
                <span key={role} className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 shadow-sm">
                  {role}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
