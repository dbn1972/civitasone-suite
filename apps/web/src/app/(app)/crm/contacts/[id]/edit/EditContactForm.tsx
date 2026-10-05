"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { rupeesToMinorString } from "@/lib/money";
import { saveClassification, type ClassificationPatch, type Temperature, type Priority } from "@/lib/crm/leadQualification";
import { buildContactPatch, isEmptyPatch } from "@/lib/crm/contactPatch";
import { ClassificationFields, type ClassificationFormValue } from "../../../../../_components/crm/ClassificationFields";
import { DuplicateCheckPanel } from "../../../../../_components/crm/DuplicateCheckPanel";
import { duplicateCheck, parseFieldError, type DuplicateCandidate, type ValidatedField } from "@/lib/crm/dataQuality";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";
import { Button, EntityPicker, type EntityOption } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { ArrowLeft } from "lucide-react";

type Initial = {
  name: string;
  email?: string;
  phone?: string;
  organization?: string;
  /** GAP-CRM-CONTACTS-NEW-02: the currently-linked account id (if any). */
  accountId?: string;
  designation?: string;
  city?: string;
  leadStatus?: string;
  marketingConsent?: boolean;
  temperature?: string;
  priority?: string;
  segment?: string;
  product?: string;
  region?: string;
  expectedValueMinor?: string;
};

/** Masked email/phone shown as placeholders when the viewer may not read PII (server-masked). */
type MaskedPii = { email?: string; phone?: string; hint: string };
type Props = { params: { id: string }; initial: Initial; maskedPii?: MaskedPii };

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

/** Paise integer string → rupees decimal string for the money input prefill. */
function minorToRupees(minor?: string): string {
  if (!minor) return "";
  if (!/^\d+$/.test(minor)) return "";
  const n = BigInt(minor);
  const rupees = n / 100n;
  const paise = n % 100n;
  return paise === 0n ? rupees.toString() : `${rupees}.${paise.toString().padStart(2, "0")}`;
}

function isTemperature(v: string): v is Temperature {
  return v === "hot" || v === "warm" || v === "cold";
}
function isPriority(v: string): v is Priority {
  return v === "high" || v === "medium" || v === "low";
}

/**
 * GAP-CRM-CONTACTS-NEW-02: account search/resolve for the edit form's account
 * EntityPicker, mirroring the New Contact form. `resolve` seeds the label for
 * the already-linked accountId on first render so the picker shows the account
 * name, not a bare id.
 */
async function searchAccounts(query: string, signal: AbortSignal): Promise<EntityOption[]> {
  try {
    const res = await browserFetch("v1/crm/accounts", { signal });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: Array<{ id?: string; name?: string }> };
    const q = query.trim().toLowerCase();
    return (body.data ?? [])
      .filter((a): a is { id: string; name: string } => Boolean(a.id && a.name))
      .filter((a) => (q ? a.name.toLowerCase().includes(q) : true))
      .slice(0, 20)
      .map((a) => ({ id: a.id, label: a.name }));
  } catch {
    return [];
  }
}

async function resolveAccounts(ids: string[]): Promise<EntityOption[]> {
  try {
    const res = await browserFetch("v1/crm/accounts", {});
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: Array<{ id?: string; name?: string }> };
    const want = new Set(ids);
    return (body.data ?? [])
      .filter((a): a is { id: string; name: string } => Boolean(a.id && a.name && want.has(a.id)))
      .map((a) => ({ id: a.id, label: a.name }));
  } catch {
    return [];
  }
}

export default function EditContactForm({ params, initial, maskedPii }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: initial.name,
    email: initial.email ?? "",
    phone: initial.phone ?? "",
    company: initial.organization ?? "",
    designation: initial.designation ?? "",
    city: initial.city ?? "",
    marketingConsent: initial.marketingConsent ?? false,
  });
  // GAP-CRM-CONTACTS-NEW-02: the linked account. Seeded from the saved
  // accountId; the label is resolved by the picker's resolve() on first render.
  const [accountId, setAccountId] = useState<string | null>(initial.accountId ?? null);
  const [accountLabel, setAccountLabel] = useState<string>(initial.organization ?? "");
  const [classification, setClassification] = useState<ClassificationFormValue>({
    temperature: initial.temperature && isTemperature(initial.temperature) ? initial.temperature : "",
    priority: initial.priority && isPriority(initial.priority) ? initial.priority : "",
    segment: initial.segment ?? "",
    product: initial.product ?? "",
    region: initial.region ?? "",
    expectedValueRupees: minorToRupees(initial.expectedValueMinor),
  });
  const [evError, setEvError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const formError = useFormError("contact");
  const t = useTranslations("crmEditContactForm");
  // GAP-CRM-CONTACTS-DETAIL-EDIT-03: once the core PATCH has persisted, latch
  // this so a later classification failure is reported as a PARTIAL save and a
  // retry re-sends ONLY the classification, never re-persisting the core fields.
  const [coreSaved, setCoreSaved] = useState(false);
  // GAP-CRM-CONTACTS-DETAIL-EDIT-05: per-field validation errors mapped from the
  // backend's format codes (e.g. INVALID_MOBILE) and inline duplicate detection.
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ValidatedField, string>>>({});
  const [candidates, setCandidates] = useState<DuplicateCandidate[]>([]);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState(false);
  const checkSeq = useRef(0);
  const phoneErrId = useId();

  function updateClassification(patch: Partial<ClassificationFormValue>) {
    setClassification((c) => ({ ...c, ...patch }));
    if ("expectedValueRupees" in patch) setEvError("");
  }

  /**
   * GAP-CRM-CONTACTS-DETAIL-EDIT-05: on blur of a changed email/phone, check for
   * other contacts with the same value and show the DuplicateCheckPanel. The
   * CURRENT contact is always excluded (params.id) so an edit never flags
   * itself as its own duplicate.
   */
  async function runDuplicateCheck() {
    const emailChanged = form.email.trim() && form.email.trim() !== (initial.email ?? "").trim();
    const phoneChanged = form.phone.trim() && form.phone.trim() !== (initial.phone ?? "").trim();
    if (!emailChanged && !phoneChanged) {
      setCandidates([]);
      return;
    }
    const seq = ++checkSeq.current;
    setChecking(true);
    setCheckError(false);
    try {
      const found = await duplicateCheck({
        name: form.name || undefined,
        email: emailChanged ? form.email : undefined,
        phone: phoneChanged ? form.phone : undefined,
        company: form.company || undefined,
      });
      if (seq === checkSeq.current) setCandidates(found.filter((c) => c.id !== params.id));
    } catch {
      if (seq === checkSeq.current) {
        setCandidates([]);
        setCheckError(true);
      }
    } finally {
      if (seq === checkSeq.current) setChecking(false);
    }
  }

  /**
   * Build the classification PATCH body, converting rupees→paise. An empty
   * selection/field is sent as explicit `null` so picking "—" (or clearing a
   * text field) clears the stored value — the classify consumer treats null as
   * "clear", whereas omitting the key would leave the old value in place.
   * Returns the sentinel `INVALID` when the expected value is present but not a
   * valid amount, so the caller can surface an inline error.
   */
  function buildClassificationPatch(): ClassificationPatch | "INVALID" {
    const ev = classification.expectedValueRupees.trim();
    let expectedValueMinor: string | null = null;
    if (ev) {
      const minor = rupeesToMinorString(ev);
      if (!minor) return "INVALID";
      expectedValueMinor = minor;
    }
    return {
      temperature: classification.temperature || null,
      priority: classification.priority || null,
      segment: classification.segment.trim() || null,
      product: classification.product.trim() || null,
      region: classification.region.trim() || null,
      expectedValueMinor,
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    setEvError("");
    setFieldErrors({});

    const classificationPatch = buildClassificationPatch();
    if (classificationPatch === "INVALID") {
      setEvError("Enter expected value as a positive amount in rupees (up to 2 decimals).");
      return;
    }

    setBusy(true);
    try {
      // GAP-CRM-CONTACTS-DETAIL-EDIT-01: send only changed fields, mapping a
      // cleared field to explicit null (DPDP correction/erasure). leadStatus is
      // deliberately NOT part of this patch — see GAP-CRM-CONTACTS-DETAIL-EDIT-02
      // (status changes must go through the governed LeadTransitionControl).
      const corePatch = buildContactPatch(
        {
          name: initial.name,
          email: initial.email,
          phone: initial.phone,
          company: initial.organization,
          designation: initial.designation,
          city: initial.city,
        },
        {
          name: form.name,
          email: form.email,
          phone: form.phone,
          company: accountId ? accountLabel : form.company,
          designation: form.designation,
          city: form.city,
        },
      );
      // Marketing consent only when it actually changed.
      const consentChanged = form.marketingConsent !== (initial.marketingConsent ?? false);
      const body: Record<string, unknown> = { ...corePatch };
      if (consentChanged) body.marketingConsent = form.marketingConsent;
      // GAP-CRM-CONTACTS-NEW-02: when the linked account changed, send accountId
      // (null to unlink) so the Accounts "Linked contacts" / "View contacts"
      // stay driven by the link, not a fragile name match. company is already
      // carried by corePatch above (set to the account name when linked).
      const accountChanged = (accountId ?? null) !== (initial.accountId ?? null);
      if (accountChanged) body.accountId = accountId;

      // GAP-CRM-CONTACTS-DETAIL-EDIT-03: run the core PATCH only when something
      // core/consent changed AND it is not already saved from a prior attempt,
      // so a retry after a classification failure never re-persists the core.
      if ((!isEmptyPatch(corePatch) || consentChanged || accountChanged) && !coreSaved) {
        const res = await browserFetch(`v1/crm/contacts/${params.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          // GAP-CRM-CONTACTS-DETAIL-EDIT-05: surface a format error (e.g.
          // INVALID_MOBILE) under its field instead of one generic banner.
          const parsed = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
          const fe = parseFieldError({ code: parsed?.code, message: parsed?.message });
          if (fe) {
            setFieldErrors({ [fe.field]: fe.message });
            return;
          }
          throw new Error(await errorMessageFromResponse(res));
        }
        setCoreSaved(true);
      }
      // LQ-003: persist classification on its dedicated endpoint, in its OWN
      // try/catch so a classification failure after the core already saved is a
      // PARTIAL success — the form stays open and the user can retry just this.
      try {
        await saveClassification(params.id, classificationPatch);
      } catch (ce) {
        setError(
          coreSaved || !isEmptyPatch(corePatch) || consentChanged
            ? t("classificationPartialSave")
            : ce instanceof Error ? ce.message : t("classificationSaveError"),
        );
        return;
      }
      setMessage("Contact updated.");
      setTimeout(() => router.push(`/crm/contacts/${params.id}`), 500);
    } catch (e) {
      setError(formError.fromException("save", e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <a className="back" href={`/crm/contacts/${params.id}`}><ArrowLeft aria-hidden="true" size={14} /> Contact</a>
      <div className="ph" style={{ marginTop: 6 }}><h1>Edit Contact</h1></div>
      {message ? (
        <div role="status" aria-live="polite" className="banner" style={{ background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      {error ? (
        <div role="alert" aria-live="assertive" className="banner" style={{ background: "#fef2f2", color: "#b42318", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{error}</div>
      ) : null}
      <div className="card">
        <form onSubmit={submit} className="pad" style={{ display: "grid", gap: 14, maxWidth: 720 }}>
          <div>
            <label htmlFor="edit-name" style={labelStyle}>Full name</label>
            <input id="edit-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="edit-email" style={labelStyle}>Email</label>
            <input id="edit-email" type="email" value={form.email} placeholder={maskedPii?.email} aria-describedby={maskedPii ? "edit-pii-hint" : undefined} onChange={(e) => setForm({ ...form, email: e.target.value })} onBlur={() => void runDuplicateCheck()} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="edit-phone" style={labelStyle}>Phone</label>
            <input
              id="edit-phone"
              value={form.phone}
              placeholder={maskedPii?.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              onBlur={() => void runDuplicateCheck()}
              style={inputStyle}
              aria-invalid={fieldErrors.phone ? true : undefined}
              aria-describedby={[fieldErrors.phone ? phoneErrId : null, maskedPii ? "edit-pii-hint" : null].filter(Boolean).join(" ") || undefined}
            />
            {fieldErrors.phone ? <p id={phoneErrId} role="alert" style={{ fontSize: 12, color: "#b42318", marginTop: 4 }}>{fieldErrors.phone}</p> : null}
            {maskedPii ? <p id="edit-pii-hint" style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>{maskedPii.hint}</p> : null}
          </div>
          <div>
            <label htmlFor="edit-company" style={labelStyle}>Organisation</label>
            {/* GAP-CRM-CONTACTS-NEW-02: link to an existing account via the
                shared EntityPicker so the Accounts screens' Linked-Contacts /
                "View contacts" follow accountId, not a fragile name match.
                Clearing the picker falls back to the free-text organisation. */}
            <EntityPicker
              aria-label={t("linkAccountAria")}
              value={accountId}
              onChange={(v) => {
                const id = typeof v === "string" ? v : null;
                setAccountId(id);
                if (!id) setAccountLabel("");
              }}
              search={searchAccounts}
              resolve={async (ids) => {
                const opts = await resolveAccounts(ids);
                if (opts[0]) setAccountLabel(opts[0].label);
                return opts;
              }}
              initialOptions={accountId && accountLabel ? [{ id: accountId, label: accountLabel }] : undefined}
              placeholder={t("searchAccounts")}
            />
            {accountId ? (
              <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                {t.rich("linkedTo", { name: accountLabel || accountId, strong: (chunks) => <strong>{chunks}</strong> })}
              </p>
            ) : (
              <input id="edit-company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder={t("typeNewOrg")} style={{ ...inputStyle, marginTop: 6 }} />
            )}
          </div>
          <div>
            <label htmlFor="edit-designation" style={labelStyle}>Designation</label>
            <input id="edit-designation" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="edit-city" style={labelStyle}>City</label>
            <input id="edit-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <span style={labelStyle}>{t("leadStatus")}</span>
            {/* GAP-CRM-CONTACTS-DETAIL-EDIT-02: status changes are governed
                (reason/transition rules + audit) and must go through the
                Change lead status control on the contact page, not this
                generic edit form. Shown read-only here. */}
            <p style={{ margin: 0, display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontWeight: 600 }}>
                {(initial.leadStatus ?? "new").charAt(0).toUpperCase() + (initial.leadStatus ?? "new").slice(1)}
              </span>
              <a className="link" href={`/crm/contacts/${params.id}`}>{t("changeStatus")}</a>
            </p>
          </div>

          <ClassificationFields value={classification} onChange={updateClassification} expectedValueError={evError} />

          {/* GAP-CRM-CONTACTS-DETAIL-EDIT-05: inline duplicate detection on a
              changed email/phone, excluding the contact being edited. */}
          <DuplicateCheckPanel
            candidates={candidates}
            checking={checking}
            error={checkError}
            mergeHrefBase="/crm/contacts/"
            onMerge={(c) => router.push(`/crm/contacts/${c.id}`)}
          />

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={form.marketingConsent} onChange={(e) => setForm({ ...form, marketingConsent: e.target.checked })} />
            Marketing consent (DPDP)
          </label>
          <div>
            <Button type="submit" disabled={busy} loading={busy} style={{ minHeight: 44 }}>{busy ? "Saving…" : "Save changes"}</Button>
          </div>
        </form>
      </div>
    </>
  );
}
