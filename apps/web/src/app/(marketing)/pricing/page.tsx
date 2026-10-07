import Link from "next/link";
import type { Metadata } from "next";
import { SMALL_OFFICE_PRICE, PSU_PRICE } from "../_data/pricing";

export const metadata: Metadata = {
  title: "Pricing — CivitasOne",
  description: "Free for small offices. Transparent pricing for PSU and Government departments.",
};

// A plan feature row. `sla` is intentionally nullable: not every edition
// carries an SLA, and we must not print a bare "—" as if it were a value
// (GAP-PRICING-HOME-06).
type Plan = {
  name: string;
  price: string;
  priceSub: string;
  users: string;
  // GAP-PRICING-HOME-04: module entitlement is a plain count. The support
  // tier is a separate feature row, so these are no longer conflated into a
  // single "All 33 + dedicated support" string.
  modules: string;
  storage: string;
  support: string;
  sla: string | null;
  cta: string;
  ctaHref: string;
  highlight: boolean;
};

const plans: readonly Plan[] = [
  {
    name: "Small Office",
    price: SMALL_OFFICE_PRICE,
    priceSub: "self-host",
    users: "Up to 25",
    modules: "5 core modules",
    storage: "10 GB",
    support: "Community",
    sla: null,
    cta: "Download",
    ctaHref: "https://github.com/civitasone",
    highlight: false,
  },
  {
    name: "PSU",
    price: PSU_PRICE,
    priceSub: "per instance",
    users: "Up to 500",
    modules: "All 33 modules",
    storage: "100 GB",
    support: "Email + Phone",
    sla: "99.5%",
    // GAP-PRICING-HOME-01: there is no /auth/register route and no trial
    // provisioning backend, so "Start Free Trial" -> /auth/register 404'd.
    // Point the primary conversion to the existing /contact route with the
    // plan prefilled, and label it honestly as a demo request.
    cta: "Request a demo",
    ctaHref: "/contact?plan=psu",
    highlight: true,
  },
  {
    name: "Government Department",
    price: "Custom pricing",
    priceSub: "contact sales",
    users: "Unlimited",
    modules: "All 33 modules",
    storage: "Unlimited",
    support: "Dedicated CSM + dedicated support",
    sla: "99.9%",
    cta: "Contact Sales",
    ctaHref: "/contact?plan=government",
    highlight: false,
  },
] as const;

const faqs = [
  {
    q: "Is CivitasOne really free?",
    a: "Yes. The Small Office edition is fully open-source and free to self-host forever. No feature gates, no time limits.",
  },
  {
    q: "What does 'self-host' mean?",
    a: "You run CivitasOne on your own servers or cloud account. We provide Docker images, Helm charts, and one-click installers for AWS and on-prem Kubernetes.",
  },
  {
    q: "Can I upgrade from Small Office to PSU later?",
    a: "Absolutely. Your data stays in place. You just unlock more modules and user seats with a license key.",
  },
  {
    q: "Is there a setup or onboarding fee?",
    a: "No. For PSU and Government plans, onboarding support is included in the subscription.",
  },
  {
    q: "What payment methods do you accept?",
    a: "UPI, NEFT/RTGS, credit cards, and government purchase orders (for Department plans).",
  },
  {
    q: "Do you offer discounts for multi-year contracts?",
    a: "Annual billing is discounted 15% versus paying monthly — for the PSU edition that is ₹1,53,000/year instead of ₹1,80,000. Multi-year agreements for Government departments come with additional SLA guarantees. Ask us for a quote.",
  },
  {
    q: "What happens to my data if I cancel?",
    a: "Your data is yours. We provide a full export in standard formats (CSV, JSON, SQL). Self-hosted customers keep everything on their own infrastructure.",
  },
  {
    q: "Is CivitasOne compliant with government procurement rules?",
    a: "CivitasOne is designed to support GFR 2017 procurement workflows, DPDP Act data-protection practices (audit trails, encryption, data export and deletion), and CERT-In security guidance. These are design goals, not a claim of formal certification or empanelment; our current certification and empanelment status is available on request.",
  },
] as const;

export default function PricingPage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-white bg-gradient-to-b from-white to-gray-50 py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold text-gray-900 sm:text-5xl">Simple, transparent pricing</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-500">
            Free for small offices. Affordable for PSU. Fully supported for Government departments.
          </p>
        </div>
      </section>

      {/* Plan Cards */}
      <section className="bg-white py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-8 md:grid-cols-3" data-testid="pricing-cards">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-2xl border p-8 ${
                  plan.highlight
                    ? "border-gray-900 shadow-xl ring-1 ring-gray-900"
                    : "border-gray-200 shadow-sm"
                }`}
              >
                {plan.highlight && (
                  <span
                    data-testid="popular-badge"
                    className="absolute -top-3 start-6 max-w-[calc(100%-3rem)] truncate rounded-full bg-gray-900 px-3 py-1 text-xs font-semibold text-white"
                  >
                    Most Popular
                  </span>
                )}
                <h3 className="text-lg font-semibold text-gray-900">{plan.name}</h3>
                <div className="mt-4">
                  <span className="text-3xl font-bold text-gray-900">{plan.price}</span>
                  <span className="ms-2 text-sm text-gray-500">{plan.priceSub}</span>
                </div>
                <ul className="mt-8 space-y-4 text-sm text-gray-600">
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 text-green-600" aria-hidden="true">✓</span> {plan.users} users
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 text-green-600" aria-hidden="true">✓</span> {plan.modules}
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 text-green-600" aria-hidden="true">✓</span> {plan.storage} storage
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 text-green-600" aria-hidden="true">✓</span> {plan.support} support
                  </li>
                  {plan.sla ? (
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5 text-green-600" aria-hidden="true">✓</span> SLA: {plan.sla}
                    </li>
                  ) : (
                    <li className="flex items-start gap-2 text-gray-500">
                      <span className="mt-0.5 text-gray-400" aria-hidden="true">○</span> SLA: none (community)
                    </li>
                  )}
                </ul>
                <Link
                  href={plan.ctaHref}
                  className={`mt-8 block w-full rounded-lg px-4 py-3 text-center text-sm font-semibold transition-colors ${
                    plan.highlight
                      ? "bg-gray-900 text-white hover:bg-gray-800"
                      : "border border-gray-300 text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-gray-50 py-20 sm:py-28">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <h2 className="text-center text-3xl font-bold text-gray-900">Frequently asked questions</h2>
          <dl className="mt-12 space-y-8" data-testid="pricing-faq">
            {faqs.map((faq) => (
              <div key={faq.q}>
                <dt className="text-base font-semibold text-gray-900">{faq.q}</dt>
                <dd className="mt-2 text-sm text-gray-600">{faq.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </>
  );
}
