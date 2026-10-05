"use client";
/**
 * LeadFormEditor — register or amend a public lead-capture form
 * (GAP-CRM-LEAD-FORMS-01). Captures the fields the crm-service registry accepts:
 * name, allowed origins, require-consent, default lead source and a per-minute
 * rate cap. On create it surfaces the minted public form key so the admin can
 * embed it immediately. The server (capture-forms-routes.ts) is ADMIN-only and
 * remains the authority; validation here mirrors its bounds to catch bad input
 * before the round-trip.
 */
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { Modal, Button } from "../ds";
import type { CRMLeadCaptureForm } from "@civitasone/types";
import {
  createLeadForm,
  updateLeadForm,
  leadFormInputSchema,
  type LeadFormInput,
} from "@/lib/crm/leadForms";

const inputStyle = { padding: 8, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)", width: "100%" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

interface LeadFormEditorProps {
  open: boolean;
  /** The form being edited, or null to register a new one. */
  form: CRMLeadCaptureForm | null;
  onClose: () => void;
  /** Called after a successful save so the parent can refresh the list. */
  onSaved: (result: { formKey?: string }) => void;
}

/** Split a textarea value into trimmed, non-empty origin lines. */
function parseOrigins(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function LeadFormEditor({ open, form, onClose, onSaved }: LeadFormEditorProps) {
  const isEdit = form !== null;
  const t = useTranslations("crmLeadFormEditor");
  const headingId = useId();
  const [name, setName] = useState(form?.name ?? "");
  const [origins, setOrigins] = useState((form?.allowedOrigins ?? []).join("\n"));
  const [requireConsent, setRequireConsent] = useState(form?.requireConsent ?? true);
  const [defaultLeadSource, setDefaultLeadSource] = useState(form?.defaultLeadSource ?? "");
  const [maxPerMinute, setMaxPerMinute] = useState(String(form?.maxPerMinute ?? 60));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const formError = useFormError("lead form");

  async function submit() {
    setError("");
    const originList = parseOrigins(origins);
    const rate = Number(maxPerMinute);
    const input: LeadFormInput = {
      name: name.trim(),
      requireConsent,
      // Only send origins when the admin supplied any; an empty array means
      // "any origin" and is a deliberate, separate choice we don't force here.
      ...(originList.length > 0 ? { allowedOrigins: originList } : {}),
      ...(defaultLeadSource.trim() ? { defaultLeadSource: defaultLeadSource.trim() } : {}),
      ...(Number.isFinite(rate) ? { maxPerMinute: rate } : {}),
    };
    const parsed = leadFormInputSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("checkFields"));
      return;
    }
    setBusy(true);
    try {
      if (isEdit && form) {
        await updateLeadForm(form.id, parsed.data);
        onSaved({});
      } else {
        const { formKey } = await createLeadForm(parsed.data);
        onSaved({ formKey });
      }
    } catch (e) {
      setError(formError.fromException("save", e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? t("editTitle", { name: form?.name ?? "" }) : t("registerTitle")} describedById={headingId}>
      <p id={headingId} style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }}>
        {isEdit
          ? t("editHint")
          : t("registerHint")}
      </p>

      {error ? (
        <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", margin: "0 0 10px" }}>
          {error}
        </p>
      ) : null}

      <div style={{ display: "grid", gap: 12 }}>
        <div>
          <label htmlFor={`${headingId}-name`} style={labelStyle}>{t("name")}</label>
          <input id={`${headingId}-name`} value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder={t("namePlaceholder")} />
        </div>
        <div>
          <label htmlFor={`${headingId}-origins`} style={labelStyle}>{t("origins")}</label>
          <textarea id={`${headingId}-origins`} value={origins} onChange={(e) => setOrigins(e.target.value)} rows={3} style={{ ...inputStyle, minHeight: 72 }} placeholder="https://www.example.gov.in" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label htmlFor={`${headingId}-source`} style={labelStyle}>{t("defaultSource")}</label>
            <input id={`${headingId}-source`} value={defaultLeadSource} onChange={(e) => setDefaultLeadSource(e.target.value)} style={inputStyle} placeholder="public_form" />
          </div>
          <div>
            <label htmlFor={`${headingId}-rate`} style={labelStyle}>{t("maxPerMinute")}</label>
            <input id={`${headingId}-rate`} type="number" min={1} max={600} step={1} value={maxPerMinute} onChange={(e) => setMaxPerMinute(e.target.value)} style={{ ...inputStyle, textAlign: "end" }} />
          </div>
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={requireConsent} onChange={(e) => setRequireConsent(e.target.checked)} aria-label={t("requireConsentAria")} />
          {t("requireConsentLabel")}
        </label>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>{t("cancel")}</Button>
        <Button type="button" onClick={() => void submit()} disabled={busy}>
          {busy ? t("saving") : isEdit ? t("saveForm") : t("registerForm")}
        </Button>
      </div>
    </Modal>
  );
}
