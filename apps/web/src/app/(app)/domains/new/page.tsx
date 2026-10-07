"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, Input, PageHeader, Select, Textarea } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { DOMAIN_TYPES, domainSchema, toFieldErrors } from "../schema";

const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
  "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman & Nicobar Islands", "Chandigarh", "Dadra & Nagar Haveli and Daman & Diu",
  "Delhi", "Jammu & Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
];

const DOMAIN_TYPE_LABELS: Record<(typeof DOMAIN_TYPES)[number], string> = {
  "gov.in": ".gov.in — Central Government",
  "state.gov.in": "State Government (<state>.gov.in)",
  "nic.in": ".nic.in — NIC Hosted",
};

export default function NewDomainPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    domainName: "",
    organisation: "",
    contactEmail: "",
    contactPhone: "",
    department: "",
    state: "",
    domainType: "gov.in",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const formError = useFormError("domain");

  function clearFieldError(name: string) {
    setFieldErrors((f) => (f[name] ? { ...f, [name]: "" } : f));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // GAP-DOMAINS-NEW-02/03: validate everything with the shared zod schema
    // (not includes("@") / a mis-written regex). GAP-DOMAINS-NEW-06: lower-case
    // and trim happen HERE (and in the schema), not on every keystroke.
    const parsed = domainSchema.safeParse(form);
    if (!parsed.success) {
      setFieldErrors(toFieldErrors(parsed.error));
      return;
    }
    setFieldErrors({});
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      // GAP-DOMAINS-NEW-01: there is no /domains/[id] detail route in this
      // snapshot, so routing to /domains/{id} on success landed on a 404.
      // Route to the /domains index (created alongside this fix) instead.
      router.push("/domains");
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Register New Domain"
        subtitle="Add a government domain for GovUX audit and WCAG compliance tracking."
        back="/domains"
        backLabel="Domains"
      />

      {error && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            background: "color-mix(in srgb, var(--bad) 12%, transparent)",
            color: "var(--bad)",
            border: "1px solid color-mix(in srgb, var(--bad) 35%, transparent)",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <div className="card">
        {/* GAP-DOMAINS-NEW-03: noValidate so the custom accessible messages are
            shown consistently rather than being pre-empted by native type=email
            / required browser validation. */}
        <form onSubmit={handleSubmit} noValidate style={{ padding: 24 }}>
          <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 18 }}>
            Fields marked * are required.
          </p>

          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", marginBottom: 20 }}>
            <Field label="Domain Name" required error={fieldErrors.domainName || undefined}>
              <Input
                type="text"
                value={form.domainName}
                // GAP-DOMAINS-NEW-06: store the raw text; do NOT lower-case on
                // each keystroke (that moved the caret to the end mid-string).
                // Lower-casing happens on blur and in the submitted payload.
                onChange={(e) => { setForm({ ...form, domainName: e.target.value }); clearFieldError("domainName"); }}
                onBlur={(e) => setForm((f) => ({ ...f, domainName: e.target.value.trim().toLowerCase() }))}
                placeholder="example.gov.in"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>

            <Field label="Domain Type" required error={fieldErrors.domainType || undefined}>
              <Select
                value={form.domainType}
                onChange={(e) => { setForm({ ...form, domainType: e.target.value }); clearFieldError("domainType"); }}
              >
                {DOMAIN_TYPES.map((t) => (
                  <option key={t} value={t}>{DOMAIN_TYPE_LABELS[t]}</option>
                ))}
              </Select>
            </Field>

            <Field label="Organisation" required error={fieldErrors.organisation || undefined}>
              <Input
                type="text"
                value={form.organisation}
                onChange={(e) => { setForm({ ...form, organisation: e.target.value }); clearFieldError("organisation"); }}
                placeholder="Ministry of Electronics and IT"
              />
            </Field>

            <Field label="Department / Division">
              <Input
                type="text"
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
                placeholder="e.g. Digital India Division"
              />
            </Field>

            <Field label="State / UT">
              <Select
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
              >
                <option value="">— Select state / UT —</option>
                {INDIAN_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </Field>

            <Field label="Contact Email" required error={fieldErrors.contactEmail || undefined}>
              <Input
                type="email"
                value={form.contactEmail}
                onChange={(e) => { setForm({ ...form, contactEmail: e.target.value }); clearFieldError("contactEmail"); }}
                placeholder="webmaster@example.gov.in"
              />
            </Field>

            <Field label="Contact Phone" error={fieldErrors.contactPhone || undefined}>
              <Input
                type="tel"
                value={form.contactPhone}
                onChange={(e) => { setForm({ ...form, contactPhone: e.target.value }); clearFieldError("contactPhone"); }}
                placeholder="011-24301001"
                inputMode="tel"
              />
            </Field>
          </div>

          <Field label="Notes">
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Any relevant context about this domain — e.g. legacy CMS, prior audit findings…"
              rows={3}
              style={{ resize: "vertical" }}
            />
          </Field>

          {/* GAP-DOMAINS-NEW-05: DPDP purpose/consent notice for the personal
              contact data collected above. */}
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "16px 0 24px" }}>
            The contact email and phone are collected only to reach the domain
            owner about GovUX audit and compliance matters, and are stored with
            the domain record. They are not used for any other purpose.
          </p>

          <div style={{ display: "flex", gap: 10 }}>
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              {busy ? "Registering…" : "Register Domain"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
