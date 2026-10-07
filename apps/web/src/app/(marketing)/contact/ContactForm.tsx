"use client";

import { useState } from "react";
import {
  CONTACT_FIELD_IDS,
  CONTACT_TOPICS,
  CONTACT_TOPIC_LABELS,
  firstInvalidFieldId,
  validateContact,
  type ContactFieldErrors,
  type ContactFormInput,
  type ContactTopic,
} from "./contactForm";

/**
 * Public enquiry form (GAP-CONTACT-HOME-01/02).
 *
 * Posts to `/api/contact`, which forwards to crm-service's public lead-capture
 * endpoint. Validation runs client-side first (inline errors, focus the first bad
 * field); the server re-validates. On success we show the backend's real reference
 * (its correlationId) — never a client-invented number. A DPDP consent checkbox is
 * required before submit.
 */
export function ContactForm() {
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [topic, setTopic] = useState<ContactTopic>("sales");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<ContactFieldErrors>({});
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [feedback, setFeedback] = useState("");
  const [reference, setReference] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input: ContactFormInput = { name, department, email, phone, topic, consent };
    const localErrors = validateContact(input);
    if (Object.keys(localErrors).length > 0) {
      setErrors(localErrors);
      setStatus("error");
      setFeedback("Please correct the highlighted fields.");
      const id = firstInvalidFieldId(localErrors);
      if (id && typeof document !== "undefined") document.getElementById(id)?.focus();
      return;
    }
    setErrors({});
    setStatus("submitting");
    setFeedback("");

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, department, email, phone, topic, consent }),
      });
      if (res.status === 503) {
        setStatus("error");
        setFeedback(
          "The enquiry form is not available right now. Please email us using the addresses below.",
        );
        return;
      }
      if (res.status === 429) {
        setStatus("error");
        setFeedback("Too many submissions — please try again shortly.");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        setFeedback("We could not submit your enquiry. Please email us using the addresses below.");
        return;
      }
      const data = (await res.json().catch(() => null)) as { reference?: unknown } | null;
      setReference(typeof data?.reference === "string" ? data.reference : null);
      setStatus("success");
      setFeedback("");
    } catch {
      setStatus("error");
      setFeedback("We could not submit your enquiry. Please email us using the addresses below.");
    }
  }

  if (status === "success") {
    return (
      <div
        data-testid="contact-success"
        role="status"
        className="rounded-2xl border border-green-200 bg-green-50 p-6"
      >
        <h2 className="text-lg font-semibold text-green-800">Thank you — your enquiry has been received</h2>
        <p className="mt-2 text-sm text-green-700">
          A member of our team will respond within 3 business days.
        </p>
        {reference && (
          <p className="mt-3 text-sm text-green-800">
            Your reference number:{" "}
            <span className="font-mono font-semibold tracking-wide" data-testid="contact-reference">
              {reference}
            </span>
          </p>
        )}
      </div>
    );
  }

  const fe = (field: keyof ContactFormInput) => errors[field];

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-5" aria-labelledby="contact-form-heading">
      <h2 id="contact-form-heading" className="text-xl font-semibold text-gray-900">
        Send us a message
      </h2>

      <TextField
        id={CONTACT_FIELD_IDS.name}
        label="Name"
        value={name}
        onChange={setName}
        required
        autoComplete="name"
        error={fe("name")}
      />
      <TextField
        id={CONTACT_FIELD_IDS.department}
        label="Department or organisation"
        value={department}
        onChange={setDepartment}
        autoComplete="organization"
        error={fe("department")}
      />
      <TextField
        id={CONTACT_FIELD_IDS.email}
        label="Email"
        type="email"
        value={email}
        onChange={setEmail}
        required
        autoComplete="email"
        error={fe("email")}
      />
      <TextField
        id={CONTACT_FIELD_IDS.phone}
        label="Phone (optional)"
        type="tel"
        value={phone}
        onChange={setPhone}
        autoComplete="tel"
        error={fe("phone")}
      />

      <div>
        <label htmlFor={CONTACT_FIELD_IDS.topic} className="mb-1 block text-sm font-medium text-gray-700">
          Topic
        </label>
        <select
          id={CONTACT_FIELD_IDS.topic}
          value={topic}
          onChange={(e) => setTopic(e.target.value as ContactTopic)}
          aria-invalid={fe("topic") ? true : undefined}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
        >
          {CONTACT_TOPICS.map((t) => (
            <option key={t} value={t}>
              {CONTACT_TOPIC_LABELS[t]}
            </option>
          ))}
        </select>
        {fe("topic") && <p className="mt-1 text-sm text-red-600">{fe("topic")}</p>}
      </div>

      <fieldset className="rounded-lg border border-gray-200 p-4">
        <legend className="px-1 text-sm font-medium text-gray-700">Privacy notice (DPDP Act, 2023)</legend>
        <p id="contact-consent-notice" className="text-sm text-gray-600">
          We collect your name, organisation and contact details only to respond to this enquiry and to
          contact you about it. Your details are kept for as long as needed to handle your request and are
          then deleted.
        </p>
        <label
          htmlFor={CONTACT_FIELD_IDS.consent}
          className="mt-3 flex items-start gap-2 text-sm font-medium text-gray-900"
        >
          <input
            id={CONTACT_FIELD_IDS.consent}
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            aria-required="true"
            aria-invalid={fe("consent") ? true : undefined}
            aria-describedby={`contact-consent-notice${fe("consent") ? " contact-consent-error" : ""}`}
            className="mt-0.5 h-5 w-5 flex-shrink-0"
          />
          <span>I agree to be contacted about this enquiry.</span>
        </label>
        {fe("consent") && (
          <p id="contact-consent-error" role="alert" className="mt-2 text-sm text-red-600">
            {fe("consent")}
          </p>
        )}
      </fieldset>

      {status === "error" && feedback && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {feedback}
        </p>
      )}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="inline-flex min-h-[48px] items-center justify-center rounded-lg bg-gray-900 px-6 py-3 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-wait disabled:opacity-70"
      >
        {status === "submitting" ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  type = "text",
  required,
  autoComplete,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  error?: string;
}) {
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
      />
      {error && (
        <p id={errorId} className="mt-1 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
