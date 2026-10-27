"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, Input, PageHeader, Select } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { DOMAIN_TYPES, VERIFICATION_METHODS, registerDomainSchema, toFieldErrors } from "../schema";
import { DOMAIN_REGISTRATION_AVAILABLE } from "./availability";

const DOMAIN_TYPE_LABELS: Record<(typeof DOMAIN_TYPES)[number], string> = {
  "gov.in": ".gov.in — Central Government",
  "state.gov.in": "State Government (<state>.gov.in)",
  "nic.in": ".nic.in — NIC Hosted",
};

export default function NewDomainPage() {
  const router = useRouter();
  const t = useTranslations("domainsNew");
  const [form, setForm] = useState({
    domainName: "",
    domainType: "gov.in",
    verificationMethod: "dns_txt",
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
    const parsed = registerDomainSchema.safeParse(form);
    if (!parsed.success) {
      setFieldErrors(toFieldErrors(parsed.error));
      return;
    }
    setFieldErrors({});
    // GAP2-DOMAINS-NEW-07: kill switch (see ./availability); never issue the
    // request while registration is switched off.
    if (!DOMAIN_REGISTRATION_AVAILABLE) return;
    setBusy(true);
    setError(null);
    try {
      // D4c #12: the existing admin custom-domains API stores only the domain
      // and its verification method; send exactly that (domainType is a
      // client-side cross-check only).
      const res = await fetch("/api/proxy/v1/admin/custom-domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ domain: parsed.data.domainName, verificationMethod: parsed.data.verificationMethod }),
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
        subtitle={t("subtitle")}
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

      {/* GAP2-DOMAINS-NEW-07: honest "not available" notice while there is no
          `domains` backend (see ./availability) -- same treatment as the
          /domains index -- instead of a live-looking submit that always 404s. */}
      {!DOMAIN_REGISTRATION_AVAILABLE && (
        <div
          role="status"
          aria-live="polite"
          style={{
            background: "color-mix(in srgb, var(--warn) 12%, transparent)",
            color: "var(--warn)",
            border: "1px solid color-mix(in srgb, var(--warn) 35%, transparent)",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          {t("unavailableNotice")}
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

            <Field label={t("verificationMethod")} required error={fieldErrors.verificationMethod || undefined}>
              <Select
                value={form.verificationMethod}
                onChange={(e) => { setForm({ ...form, verificationMethod: e.target.value }); clearFieldError("verificationMethod"); }}
              >
                {VERIFICATION_METHODS.map((m) => (
                  <option key={m} value={m}>{m === "dns_txt" ? t("methodTxt") : t("methodCname")}</option>
                ))}
              </Select>
            </Field>
          </div>

          <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 24px" }}>
            {t("afterRegister")}
          </p>

          <div style={{ display: "flex", gap: 10 }}>
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={busy}
              disabled={!DOMAIN_REGISTRATION_AVAILABLE}
              title={DOMAIN_REGISTRATION_AVAILABLE ? undefined : t("unavailableTitle")}
            >
              {!DOMAIN_REGISTRATION_AVAILABLE ? t("registerUnavailable") : busy ? t("registering") : t("register")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
