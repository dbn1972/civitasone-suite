"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { z } from "zod";
import { useToast } from "@/app/_components/ds/Toast";
import { Button, PageHeader, EntityPicker, type EntityOption } from "@/app/_components/ds";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";
import { useFormError } from "@/lib/useFormError";
import { UserFacingError } from "@/lib/userFacingError";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney } from "@/lib/formatters";
import { DEAL_STAGES, STAGE_DEFAULT_PROBABILITY } from "@/lib/crm/dealStages";

/**
 * GAP-CRM-DEALS-NEW-04: async server-side contact search for the deal's optional
 * contact picker, over GET /v1/crm/contacts/lookup?q= (id + display name +
 * masked phone/email only). Replaces loading the whole registry into one
 * <select>; the picker stays optional so a failed lookup never blocks creation.
 */
async function searchContacts(query: string, signal: AbortSignal): Promise<EntityOption[]> {
  const q = query.trim();
  const res = await browserFetch(`v1/crm/contacts/lookup?q=${encodeURIComponent(q)}&limit=10`, { signal });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
  const body = (await res.json()) as { data?: Array<{ id?: string; name?: string; email?: string | null; phone?: string | null }> };
  return (body.data ?? [])
    .filter((c): c is { id: string; name: string; email?: string | null; phone?: string | null } => Boolean(c.id && c.name))
    .map((c) => ({ id: c.id, label: c.name, ...(c.email || c.phone ? { sublabel: [c.phone, c.email].filter(Boolean).join(" · ") } : {}) }));
}

// GAP-CRM-DEALS-NEW-01: a deal may only be CREATED in an open stage. Won/Lost are
// terminal outcomes of the governed close flow (POST /v1/crm/deals/:id/close, which
// requires a reason — min 10 chars for a loss — and writes the audit trail), enforced
// by DealDetailActions on the detail page. Offering "Won"/"Lost" here let a deal be
// created straight into a closed state with no reason and no confirmation, bypassing
// that governance entirely. There is no back-dating/import use case on this manual
// capture screen, so the safe default is to drop the terminal options outright.
//
// GAP-CRM-DEALS-NEW-02: the stage options now come from the single shared
// DEAL_STAGES constant (lib/crm/dealStages.ts), so the create form, the
// list/detail display and apiMappers.normalizeDealStage no longer each hold
// their own copy of the vocabulary.
const STAGE_VALUES = DEAL_STAGES.map((s) => s.value);

// GAP-CRM-DEALS-NEW-05: validate at the form boundary with zod — name required,
// a parseable non-negative paise value, probability an integer 0..100, and the
// stage restricted to the open create stages (so a Won@0% / Lead@100% mismatch
// cannot be submitted). Probability also carries a sensible per-stage default
// (STAGE_DEFAULT_PROBABILITY) that the user may still edit.
const newDealSchema = z.object({
  name: z.string().trim().min(1, "nameRequired"),
  valueMinor: z.string().regex(/^\d+$/, "amountInvalid"),
  probability: z.number().int().min(0).max(100),
  stage: z.enum(STAGE_VALUES as [string, ...string[]]),
});

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;
const errStyle = { color: "var(--bad)", fontSize: 12, marginTop: 4 } as const;

export default function NewDealPage() {
  const router = useRouter();
  const formError = useFormError("engagement");
  const t = useTranslations("crm.dealsNew");
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: "",
    stage: STAGE_VALUES[0],
    value: "",
    contactId: "",
    closeDate: "",
    // GAP-CRM-DEALS-NEW-05: start at the first stage's band, not a flat 0%.
    probability: String(STAGE_DEFAULT_PROBABILITY[STAGE_VALUES[0]] ?? 0),
  });
  const [contactLabel, setContactLabel] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function onStageChange(nextStage: string) {
    // GAP-CRM-DEALS-NEW-05: default the probability from the stage band on
    // change (editable afterwards), so the two stay coherent by default.
    setForm((f) => ({
      ...f,
      stage: nextStage,
      probability: String(STAGE_DEFAULT_PROBABILITY[nextStage] ?? f.probability),
    }));
  }

  // GAP-CRM-DEALS-NEW-03: convert rupees -> paise with the float-free
  // rupeesToMinorString (allowing ₹0), never Math.round(Number(x)*100).
  const valueMinor = form.value.trim() === "" ? "0" : rupeesToMinorString(form.value.trim(), { allowZero: true });
  const valuePreview = valueMinor !== null ? formatMoney(valueMinor) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    setFieldErrors({});

    const parsed = newDealSchema.safeParse({
      name: form.name,
      valueMinor: valueMinor ?? "",
      probability: Number(form.probability),
      stage: form.stage,
    });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && !errs[key]) errs[key] = issue.message === "nameRequired" || issue.message === "amountInvalid" ? t(issue.message) : issue.message;
      }
      setFieldErrors(errs);
      return;
    }

    setBusy(true);
    try {
      const res = await browserFetch("v1/crm/deals", {
        method: "POST",
        body: JSON.stringify({
          name: parsed.data.name,
          stage: parsed.data.stage,
          valueMinor: parsed.data.valueMinor,
          currency: "INR",
          probability: parsed.data.probability,
          ...(form.contactId ? { contactId: form.contactId } : {}),
          ...(form.closeDate ? { closeDate: form.closeDate } : {}),
        }),
      });
      if (!res.ok) throw UserFacingError.from(await formError.fromResponse(res, "save"));
      // GAP-CRM-DEALS-NEW-06: read-your-writes. The command endpoint returns the
      // new record's id (202/201 with { id } or { data: { id } }); navigate
      // straight to the new engagement so the clerk lands on what they created,
      // rather than a fixed-timeout bounce back to the list. Fall back to the
      // list only when the body carried no id. router.refresh() revalidates the
      // destination so the fresh record is read.
      let newId: string | null = null;
      try {
        const body = (await res.clone().json()) as { id?: unknown; data?: { id?: unknown } };
        const candidate = body?.data?.id ?? body?.id;
        if (typeof candidate === "string" && candidate.length > 0) newId = candidate;
      } catch {
        // No/invalid JSON body — fall back to the list.
      }
      setMessage(t("created"));
      toast.success(t("createdToast"));
      router.push(newId ? `/crm/deals/${newId}` : "/crm/deals");
      router.refresh();
    } catch (err) {
      setError(formError.fromException("save", err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/crm/deals" backLabel={t("backLabel")} />
      {message ? (
        <div role="status" aria-live="polite" className="banner" style={{ background: "var(--goodbg)", color: "var(--good)", border: "1px solid var(--goodbd)", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>
          {message}
        </div>
      ) : null}
      {error ? (
        <div role="alert" aria-live="assertive" className="banner" style={{ background: "var(--badbg)", color: "var(--bad)", border: "1px solid var(--badbd)", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>
          {error}
        </div>
      ) : null}
      <div className="card">
        <form onSubmit={submit} className="pad" style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 560 }} noValidate>
          <div>
            <label htmlFor="deal-name" style={labelStyle}>{t("nameLabel")}</label>
            <input
              id="deal-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t("namePlaceholder")}
              style={inputStyle}
              aria-invalid={fieldErrors.name ? true : undefined}
              aria-describedby={fieldErrors.name ? "deal-name-error" : undefined}
            />
            {fieldErrors.name ? <p id="deal-name-error" role="alert" style={errStyle}>{fieldErrors.name}</p> : null}
          </div>
          <div>
            <label htmlFor="deal-value" style={labelStyle}>{t("valueLabel")}</label>
            <input
              id="deal-value"
              type="text"
              inputMode="decimal"
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              placeholder={t("valuePlaceholder")}
              style={inputStyle}
              aria-invalid={fieldErrors.valueMinor ? true : undefined}
              aria-describedby={fieldErrors.valueMinor ? "deal-value-error" : "deal-value-preview"}
            />
            {/* GAP-CRM-DEALS-NEW-03: live lakh-grouped preview of the entered amount. */}
            <p id="deal-value-preview" aria-live="polite" style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
              {valuePreview ? t("valuePreview", { value: valuePreview }) : t("valueHint")}
            </p>
            {fieldErrors.valueMinor ? <p id="deal-value-error" role="alert" style={errStyle}>{fieldErrors.valueMinor}</p> : null}
          </div>
          <div>
            <label htmlFor="deal-stage" style={labelStyle}>{t("stageLabel")}</label>
            <select id="deal-stage" value={form.stage} onChange={(e) => onStageChange(e.target.value)} style={inputStyle}>
              {DEAL_STAGES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="deal-contact" style={labelStyle}>{t("contactLabel")}</label>
            {/* GAP-CRM-DEALS-NEW-04: async server search over the contacts
                lookup endpoint via the shared EntityPicker, instead of loading
                the whole registry into one <select>. Optional: a failed lookup
                never blocks creating the deal. */}
            <EntityPicker
              id="deal-contact"
              aria-label={t("contactLabel")}
              value={form.contactId || null}
              onChange={(v) => {
                const id = typeof v === "string" ? v : null;
                setForm({ ...form, contactId: id ?? "" });
                if (!id) setContactLabel("");
              }}
              search={searchContacts}
              initialOptions={form.contactId && contactLabel ? [{ id: form.contactId, label: contactLabel }] : undefined}
              placeholder={t("contactPlaceholder")}
            />
            <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
              {t("contactHint")}
            </p>
          </div>
          <div>
            <label htmlFor="deal-close" style={labelStyle}>{t("closeLabel")}</label>
            <input id="deal-close" type="date" value={form.closeDate} onChange={(e) => setForm({ ...form, closeDate: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="deal-prob" style={labelStyle}>{t("probabilityLabel")}</label>
            <input
              id="deal-prob"
              type="number"
              min={0}
              max={100}
              step="1"
              value={form.probability}
              onChange={(e) => setForm({ ...form, probability: e.target.value })}
              style={inputStyle}
              aria-invalid={fieldErrors.probability ? true : undefined}
              aria-describedby={fieldErrors.probability ? "deal-prob-error" : undefined}
            />
            {fieldErrors.probability ? <p id="deal-prob-error" role="alert" style={errStyle}>{fieldErrors.probability}</p> : null}
          </div>
          <div>
            <Button type="submit" disabled={busy} loading={busy} style={{ minHeight: 44 }}>
              {busy ? t("creating") : t("create")}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
