import type { Metadata } from "next";
import { ContactForm } from "./ContactForm";
import { CopyAddressButton } from "./CopyAddressButton";
import {
  CONTACT_EMAILS,
  CONTACT_SLA_BUSINESS_DAYS,
  SECURITY_ACK_BUSINESS_DAYS,
  contactPhone,
  contactPostalAddress,
} from "./contactDetails";

export const metadata: Metadata = {
  title: "Contact — CivitasOne",
  description:
    "Talk to the CivitasOne team about deployments, government procurement, and support. Enquiry form, phone, postal address, and security disclosure.",
};

// Distinct mailbox per channel so the "we will route you" promise is backed by real
// routing (GAP-CONTACT-HOME-02): the duplicate hello@ address is gone.
const channels = [
  {
    label: "Sales & Government Procurement",
    detail: "Custom pricing, GFR-compliant procurement, and dedicated Government/PSU onboarding.",
    email: CONTACT_EMAILS.sales,
  },
  {
    label: "General Inquiries",
    detail: "Product questions, partnership inquiries, and everything else.",
    email: CONTACT_EMAILS.general,
  },
];

export default function ContactPage() {
  const phone = contactPhone();
  const postal = contactPostalAddress();

  return (
    <section className="bg-white bg-gradient-to-b from-white to-gray-50 py-20 sm:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <h1 className="text-4xl font-bold text-gray-900 sm:text-5xl">Get in touch</h1>
        <p className="mt-4 max-w-2xl text-lg text-gray-500">
          Whether you are evaluating CivitasOne for a Government department, a PSU, or a small office,
          send us a message below and we will route you to the right team.
        </p>
        <p className="mt-2 max-w-2xl text-sm text-gray-500">
          We respond to enquiries within {CONTACT_SLA_BUSINESS_DAYS} business days.
        </p>

        {/* Primary channel: the enquiry form (works without an email client — GAP-CONTACT-HOME-01). */}
        <div className="mt-10">
          <ContactForm />
        </div>

        {/* Secondary: direct contact details, incl. a copy button for kiosk / shared PCs. */}
        <div className="mt-14">
          <h2 className="text-xl font-semibold text-gray-900">Prefer to reach us directly?</h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-1">
            {channels.map((c) => (
              <div key={c.label} className="rounded-2xl border border-gray-200 p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-900">{c.label}</h3>
                <p className="mt-2 text-sm text-gray-600">{c.detail}</p>
                <div className="mt-3 flex items-center gap-3">
                  <a
                    href={`mailto:${c.email}`}
                    className="text-sm font-medium text-gray-900 underline underline-offset-4 hover:text-gray-700"
                  >
                    {c.email}
                  </a>
                  <CopyAddressButton value={c.email} label={`Copy ${c.email}`} />
                </div>
              </div>
            ))}

            {(phone || postal) && (
              <div className="rounded-2xl border border-gray-200 p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-900">Phone &amp; post</h3>
                {phone && (
                  <p className="mt-2 text-sm text-gray-600">
                    Phone:{" "}
                    <a
                      href={`tel:${phone.replace(/\s+/g, "")}`}
                      className="font-medium text-gray-900 underline underline-offset-4 hover:text-gray-700"
                    >
                      {phone}
                    </a>
                  </p>
                )}
                {postal && (
                  <p className="mt-2 whitespace-pre-line text-sm text-gray-600">
                    <span className="font-medium text-gray-900">Post:</span>
                    {"\n"}
                    {postal}
                  </p>
                )}
              </div>
            )}

            {/* Security disclosure (GAP-CONTACT-HOME-03): private reporting, SLA, security.txt. */}
            <div className="rounded-2xl border border-gray-200 p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900">Security Reports</h3>
              <p className="mt-2 text-sm text-gray-600">
                Found a vulnerability? Please report it privately to{" "}
                <a
                  href={`mailto:${CONTACT_EMAILS.security}`}
                  className="font-medium text-gray-900 underline underline-offset-4 hover:text-gray-700"
                >
                  {CONTACT_EMAILS.security}
                </a>{" "}
                rather than opening a public issue. We acknowledge security reports within{" "}
                {SECURITY_ACK_BUSINESS_DAYS} business days and will keep you updated as we investigate.
                Please give us reasonable time to remediate before any public disclosure.
              </p>
              <p className="mt-3 text-sm text-gray-600">
                See our{" "}
                <a
                  href="/.well-known/security.txt"
                  className="font-medium text-gray-900 underline underline-offset-4 hover:text-gray-700"
                >
                  security.txt
                </a>{" "}
                for machine-readable disclosure details.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
