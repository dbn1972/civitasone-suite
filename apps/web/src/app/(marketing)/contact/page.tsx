import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact — CivitasOne",
  description: "Talk to the CivitasOne team about deployments, government procurement, and support.",
};

// GAP-PRICING-HOME-01: the /pricing PSU and Government CTAs now route here
// with ?plan=psu / ?plan=government. Map the known plan codes to a readable
// label so the page can confirm what the visitor is asking about and prefill
// the mailto subject. Unknown values are ignored (no reflected injection).
const PLAN_LABELS: Record<string, string> = {
  psu: "PSU edition",
  government: "Government Department edition",
  "small-office": "Small Office edition",
};

const channels = [
  {
    label: "Sales & Government Procurement",
    detail: "Custom pricing, GFR-compliant procurement, and dedicated Government/PSU onboarding.",
    email: "hello@civitasone.app",
  },
  {
    label: "General Inquiries",
    detail: "Product questions, partnership inquiries, and everything else.",
    email: "hello@civitasone.app",
  },
  {
    label: "Security Reports",
    detail: "Responsible disclosure of security vulnerabilities. Please do not open a public issue.",
    email: "security@civitasone.app",
  },
];

export default async function ContactPage({
  searchParams,
}: {
  searchParams?: Promise<{ plan?: string | string[] }>;
}) {
  const params = (await searchParams) ?? {};
  const rawPlan = Array.isArray(params.plan) ? params.plan[0] : params.plan;
  const planLabel = rawPlan ? PLAN_LABELS[rawPlan] : undefined;
  const salesEmail = channels[0].email;
  const salesMailto = planLabel
    ? `mailto:${salesEmail}?subject=${encodeURIComponent(`Interested in the ${planLabel}`)}`
    : `mailto:${salesEmail}`;

  return (
    <section className="bg-white bg-gradient-to-b from-white to-gray-50 py-20 sm:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <h1 className="text-4xl font-bold text-gray-900 sm:text-5xl">Get in touch</h1>
        <p className="mt-4 max-w-2xl text-lg text-gray-500">
          Whether you are evaluating CivitasOne for a Government department, a PSU, or a small office,
          reach out and we will route you to the right person.
        </p>

        {planLabel && (
          <div
            data-testid="contact-plan-interest"
            className="mt-8 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700"
          >
            You are enquiring about the{" "}
            <span className="font-semibold text-gray-900">{planLabel}</span>. Use the Sales
            channel below and we will follow up.{" "}
            <a
              href={salesMailto}
              className="font-medium text-gray-900 underline underline-offset-4 hover:text-gray-700"
            >
              Email sales about the {planLabel}
            </a>
          </div>
        )}

        <div className="mt-12 grid gap-6 sm:grid-cols-1">
          {channels.map((c) => (
            <div key={c.label} className="rounded-2xl border border-gray-200 p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">{c.label}</h2>
              <p className="mt-2 text-sm text-gray-600">{c.detail}</p>
              <a
                href={`mailto:${c.email}`}
                className="mt-3 inline-block text-sm font-medium text-gray-900 underline underline-offset-4 hover:text-gray-700"
              >
                {c.email}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
