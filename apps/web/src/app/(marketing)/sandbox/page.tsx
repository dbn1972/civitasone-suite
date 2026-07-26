import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sandbox — CivitasOne",
  description: "Try CivitasOne with realistic demo data. No sign-up required.",
};

const roles = [
  {
    icon: "🏢",
    id: "office-head",
    name: "Office Head",
    desc: "Full dashboard, approvals, budget overview",
  },
  {
    icon: "💰",
    id: "finance-clerk",
    name: "Finance Clerk",
    desc: "Bills, payments, vouchers, GL",
  },
  {
    icon: "👥",
    id: "hr-officer",
    name: "HR Officer",
    desc: "Leave, attendance, payroll, directory",
  },
  {
    icon: "🛒",
    id: "procurement",
    name: "Procurement",
    desc: "Indents, POs, vendors, GRN",
  },
  {
    icon: "📱",
    id: "small-business",
    name: "Small Business",
    desc: "Invoicing, expenses, customers",
  },
  {
    icon: "🏛️",
    id: "citizen",
    name: "Citizen",
    desc: "RTI, grievances, service requests",
  },
  {
    icon: "🔧",
    id: "admin",
    name: "Admin",
    desc: "Settings, feature flags, webhooks",
  },
] as const;

export default function SandboxPage() {
  return (
    <section className="bg-white bg-gradient-to-b from-white to-gray-50 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center">
          <span className="inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-amber-800">
            Demo Mode
          </span>
          <h1 className="mt-6 text-4xl font-bold text-gray-900 sm:text-5xl">
            Try CivitasOne — No Sign-Up Required
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-500">
            Pick a role below to see the system pre-loaded with realistic data. Resets daily.
          </p>
        </div>

        {/* Role Cards */}
        <div
          className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4"
          data-testid="sandbox-roles"
        >
          {roles.map((role) => (
            <Link
              key={role.id}
              href={`/dashboard`}
              className="group rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-all hover:border-gray-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
            >
              <div className="text-4xl">{role.icon}</div>
              <h3 className="mt-4 text-lg font-semibold text-gray-900 group-hover:text-gray-700">
                {role.name}
              </h3>
              <p className="mt-2 text-sm text-gray-500">{role.desc}</p>
              <span className="mt-4 inline-block text-sm font-medium text-gray-900 group-hover:text-gray-600">
                Enter as {role.name} →
              </span>
            </Link>
          ))}
        </div>

        {/* Disclaimer */}
        <p className="mt-12 text-center text-sm text-gray-400">
          Data is fictional. Refreshed every 24 hours. No real emails or payments are sent.
        </p>
      </div>
    </section>
  );
}
