"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button, PageHeader } from "../../../../_components/ds";
import { browserFetch } from "@/lib/api/browserClient";
import { useFormError } from "@/lib/useFormError";
import {
  getGrievanceCategories,
  grievanceCategoryOptions,
  DEFAULT_GRIEVANCE_CATEGORIES,
} from "@/lib/crm/grievanceCategories";

/**
 * GAP-CRM-GRIEVANCES-NEW-03: the authoritative category list is now the
 * per-tenant grievance-category master (crm.grievance_categories, admin page
 * /crm/grievance-categories). These nine CPGRAMS-aligned categories are kept
 * here ONLY as the documented fallback used when the tenant has configured no
 * active categories or the master fails to load — so the select is never empty
 * and no deploy is needed to add a category. Exported for backward compatibility
 * with any callers that referenced the previous constant.
 */
const GRIEVANCE_CATEGORIES = DEFAULT_GRIEVANCE_CATEGORIES.map((c) => c.label);

// GAP-CRM-GRIEVANCES-NEW-01: lightweight client-side validation so an invalid
// phone/email is caught before the request is sent (the server remains the
// authority). Indian mobile (10 digits, optional +91) or a general international
// form; email is a standard shape. Both optional — an empty value is allowed.
const PHONE_RE = /^(?:\+?91[-\s]?)?[6-9]\d{9}$|^\+?\d{7,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function NewGrievancePage() {
  const t = useTranslations("crmGrievanceNew");
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const formError = useFormError("grievance");
  // GAP-CRM-GRIEVANCES-NEW-03: load the per-tenant category master and fall back
  // to the labelled CPGRAMS-aligned list when none is configured / it fails.
  const [categories, setCategories] = useState<string[]>(GRIEVANCE_CATEGORIES);
  const [categoriesFellBack, setCategoriesFellBack] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const result = await getGrievanceCategories();
      if (!live) return;
      const { labels, fellBack } = grievanceCategoryOptions(result);
      setCategories(labels);
      setCategoriesFellBack(fellBack);
    })();
    return () => {
      live = false;
    };
  }, []);
  // GAP-CRM-GRIEVANCES-NEW-02: client-side inline errors for phone/email, keyed
  // by field name, shown beside the field just like the server ones.
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  // GAP-CRM-GRIEVANCES-NEW-05: track whether the form has unsaved input so
  // Cancel / browser-back / tab-close can warn before discarding it. A single
  // onChange on the <form> flips this; a successful submit clears it so the
  // navigation away from a saved grievance is never blocked.
  const [dirty, setDirty] = useState(false);
  // GAP-CRM-GRIEVANCES-NEW-07: live character counter for the (maxLength 5000)
  // description, announced politely to assistive tech.
  const [descriptionLength, setDescriptionLength] = useState(0);
  const DESCRIPTION_MAX = 5000;

  // GAP-CRM-GRIEVANCES-NEW-05: a native beforeunload prompt while the form is
  // dirty, so a tab-close / reload also warns. Removed once the form is clean.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // GAP-CRM-GRIEVANCES-NEW-05: intercept Cancel when there is unsaved input.
  function handleCancel(e: React.MouseEvent<HTMLAnchorElement>) {
    if (dirty && !window.confirm("Discard this grievance? Your unsaved changes will be lost.")) {
      e.preventDefault();
    }
  }

  function validateContact(phone: string, email: string): Record<string, string> {
    const errs: Record<string, string> = {};
    if (phone.trim() && !PHONE_RE.test(phone.trim())) {
      errs.citizenPhone = t("invalidPhone");
    }
    if (email.trim() && !EMAIL_RE.test(email.trim())) {
      errs.citizenEmail = t("invalidEmail");
    }
    return errs;
  }

  // Field error from either the client check or the server response.
  function fieldErr(name: string): string | undefined {
    return clientErrors[name] ?? formError.fieldError(name) ?? undefined;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const phone = (fd.get("citizenPhone") as string) ?? "";
    const email = (fd.get("citizenEmail") as string) ?? "";
    const contactErrors = validateContact(phone, email);
    setClientErrors(contactErrors);
    if (Object.keys(contactErrors).length > 0) return;

    setSaving(true);
    formError.clear();
    const body = {
      citizenName:  fd.get("citizenName"),
      citizenPhone: phone.trim() || undefined,
      citizenEmail: email.trim() || undefined,
      category:     fd.get("category"),
      subject:      fd.get("subject"),
      description:  fd.get("description") || undefined,
      priority:     fd.get("priority"),
    };

    try {
      // GAP-CRM-GRIEVANCES-NEW-05: use browserFetch so the device/trust headers
      // (x-device-id, x-device-trust-token) travel with the create, matching the
      // browserClient contract used by the other CRM forms. browserFetch sets
      // content-type itself and prefixes /api/proxy/, so pass the bare path.
      const res = await browserFetch("v1/crm/grievances", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        await formError.fromResponse(res, "save");
        setSaving(false);
        return;
      }
      const { data } = (await res.json()) as { data: { id: string } };
      // The grievance is saved; drop the unsaved-changes guard before navigating.
      setDirty(false);
      router.push(`/crm/grievances/${data.id}`);
    } catch (caught) {
      formError.fromException("save", caught);
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/crm/grievances"
        backLabel={t("backLabel")}
      />
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "var(--r)",
          padding: "24px 28px",
          maxWidth: 640,
        }}
      >
        {formError.message && (
          <div
            role="alert"
            style={{
              marginBottom: 16,
              padding: "10px 14px",
              background: "color-mix(in srgb, var(--bad) 10%, transparent)",
              border: "1px solid var(--bad)",
              borderRadius: "var(--r)",
              color: "var(--bad)",
              fontSize: 14,
            }}
          >
            {formError.message}
          </div>
        )}
        <form
          onSubmit={handleSubmit}
          onChange={() => setDirty(true)}
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
        >
          {/* GAP-CRM-GRIEVANCES-NEW-07: explain the asterisk convention in text,
              so the visual star is never the only signal a field is required
              (WCAG 2.2 AA, 1.3.1). */}
          <p style={{ fontSize: 12, color: "var(--ink2)", margin: 0 }}>
            Fields marked <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span> are required.
          </p>
          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 600, marginBottom: 12, color: "var(--ink)" }}>
              {t("citizenDetails")}
            </legend>
            {/* GAP-CRM-GRIEVANCES-NEW-01: DPDP purpose/retention notice. Phone and
                email are personal data; collected only to respond to this
                grievance. Final wording to be confirmed with the DPO. */}
            <p style={{ fontSize: 12, color: "var(--ink2)", lineHeight: 1.5, margin: "0 0 12px" }}>
              {t("dpdpNotice")}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
                <span style={{ color: "var(--ink)" }}>
                  {t("fullName")} <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
                </span>
                <input
                  name="citizenName"
                  required
                  maxLength={200}
                  placeholder={t("fullNamePlaceholder")}
                  style={{
                    padding: "8px 12px",
                    border: "1px solid var(--line)",
                    borderRadius: "var(--r)",
                    background: "var(--bg)",
                    color: "var(--ink)",
                    fontSize: 14,
                  }}
                />
                {formError.fieldError("citizenName") && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("citizenName")}</span>
                )}
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
                  <span style={{ color: "var(--ink)" }}>{t("phone")}</span>
                  <input
                    name="citizenPhone"
                    type="tel"
                    maxLength={32}
                    placeholder={t("phonePlaceholder")}
                    aria-invalid={fieldErr("citizenPhone") ? true : undefined}
                    aria-describedby={fieldErr("citizenPhone") ? "citizenPhone-error" : undefined}
                    style={{
                      padding: "8px 12px",
                      border: "1px solid var(--line)",
                      borderRadius: "var(--r)",
                      background: "var(--bg)",
                      color: "var(--ink)",
                      fontSize: 14,
                    }}
                  />
                  {fieldErr("citizenPhone") && (
                    <span id="citizenPhone-error" style={{ fontSize: 12, color: "var(--bad)" }}>{fieldErr("citizenPhone")}</span>
                  )}
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
                  <span style={{ color: "var(--ink)" }}>{t("email")}</span>
                  <input
                    name="citizenEmail"
                    type="email"
                    maxLength={320}
                    placeholder={t("emailPlaceholder")}
                    aria-invalid={fieldErr("citizenEmail") ? true : undefined}
                    aria-describedby={fieldErr("citizenEmail") ? "citizenEmail-error" : undefined}
                    style={{
                      padding: "8px 12px",
                      border: "1px solid var(--line)",
                      borderRadius: "var(--r)",
                      background: "var(--bg)",
                      color: "var(--ink)",
                      fontSize: 14,
                    }}
                  />
                  {fieldErr("citizenEmail") && (
                    <span id="citizenEmail-error" style={{ fontSize: 12, color: "var(--bad)" }}>{fieldErr("citizenEmail")}</span>
                  )}
                </label>
              </div>
            </div>
          </fieldset>

          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 600, marginBottom: 12, color: "var(--ink)" }}>
              {t("grievanceDetails")}
            </legend>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
                  <span style={{ color: "var(--ink)" }}>
                    {t("category")} <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
                  </span>
                  <select
                    name="category"
                    required
                    style={{
                      padding: "8px 12px",
                      border: "1px solid var(--line)",
                      borderRadius: "var(--r)",
                      background: "var(--bg)",
                      color: "var(--ink)",
                      fontSize: 14,
                    }}
                  >
                    <option value="">{t("selectCategory")}</option>
                    {categories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  {categoriesFellBack && (
                    <span role="note" style={{ fontSize: 12, color: "var(--ink2)" }}>
                      {t("standardCategoryNote")}
                    </span>
                  )}
                  {formError.fieldError("category") && (
                    <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("category")}</span>
                  )}
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
                  <span style={{ color: "var(--ink)" }}>{t("priority")}</span>
                  <select
                    name="priority"
                    defaultValue="normal"
                    style={{
                      padding: "8px 12px",
                      border: "1px solid var(--line)",
                      borderRadius: "var(--r)",
                      background: "var(--bg)",
                      color: "var(--ink)",
                      fontSize: 14,
                    }}
                  >
                    <option value="low">{t("priorityLow")}</option>
                    <option value="normal">{t("priorityNormal")}</option>
                    <option value="high">{t("priorityHigh")}</option>
                    <option value="urgent">{t("priorityUrgent")}</option>
                  </select>
                  {/* GAP-CRM-GRIEVANCES-NEW-04: guidance on when Urgent applies.
                      Decision (safest default): keep Urgent selectable by any
                      clerk — the backend remains the authority and the first-
                      appeal flow already bumps priority to Urgent — but add a
                      hint so it is reserved for genuine risk-to-life/safety or
                      statutory-deadline cases rather than used routinely. */}
                  <span role="note" style={{ fontSize: 12, color: "var(--ink2)" }}>
                    Use <strong>Urgent</strong> only for risk to life or safety, or a statutory deadline. First appeals are escalated to Urgent automatically.
                  </span>
                  {fieldErr("priority") && (
                    <span style={{ fontSize: 12, color: "var(--bad)" }}>{fieldErr("priority")}</span>
                  )}
                </label>
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
                <span style={{ color: "var(--ink)" }}>
                  {t("subject")} <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
                </span>
                <input
                  name="subject"
                  required
                  maxLength={500}
                  placeholder={t("subjectPlaceholder")}
                  style={{
                    padding: "8px 12px",
                    border: "1px solid var(--line)",
                    borderRadius: "var(--r)",
                    background: "var(--bg)",
                    color: "var(--ink)",
                    fontSize: 14,
                  }}
                />
                {formError.fieldError("subject") && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("subject")}</span>
                )}
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
                <span style={{ color: "var(--ink)" }}>{t("description")}</span>
                <textarea
                  name="description"
                  rows={4}
                  maxLength={DESCRIPTION_MAX}
                  onInput={(e) => setDescriptionLength((e.target as HTMLTextAreaElement).value.length)}
                  aria-describedby="description-counter"
                  placeholder={t("descriptionPlaceholder")}
                  style={{
                    padding: "8px 12px",
                    border: "1px solid var(--line)",
                    borderRadius: "var(--r)",
                    background: "var(--bg)",
                    color: "var(--ink)",
                    fontSize: 14,
                    resize: "vertical",
                  }}
                />
                {/* GAP-CRM-GRIEVANCES-NEW-07: live character counter so a clerk
                    sees why the browser stops accepting input at the limit.
                    Turns to the warning colour within 100 characters of the max. */}
                <span
                  id="description-counter"
                  aria-live="polite"
                  style={{
                    fontSize: 12,
                    alignSelf: "flex-end",
                    color: descriptionLength >= DESCRIPTION_MAX - 100 ? "var(--warn)" : "var(--ink2)",
                  }}
                >
                  {descriptionLength.toLocaleString("en-IN")}/{DESCRIPTION_MAX.toLocaleString("en-IN")}
                </span>
                {formError.fieldError("description") && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("description")}</span>
                )}
              </label>
            </div>
          </fieldset>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
            {/* GAP-CRM-GRIEVANCES-NEW-05: client-side navigation (no full page
                reload) + an unsaved-changes confirmation when the form is
                dirty. */}
            <Link href="/crm/grievances" className="btn" onClick={handleCancel}>{t("cancel")}</Link>
            <Button type="submit" disabled={saving} loading={saving}>
              {saving ? t("saving") : t("submit")}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
