"use client";

/**
 * UAT P2 (J8, D5): create a draft billing invoice on screen through the existing billing-service command
 * POST /v1/billing/invoices. The draft is then issued from its detail page (InvoiceIssuePanel). Every check is a
 * written message beside its field, and nothing is sent until the officer confirms.
 */
import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Alert, Button, ConfirmDialog } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { useFormError } from "@/lib/useFormError";
import {
  INVOICE_ITEM_KINDS, buildInvoiceBody, emptyGst, emptyItem, invoiceTotals, validateInvoiceForm,
  type InvoiceForm, type InvoiceFormErrors, type InvoiceItemForm,
} from "@/lib/admin/invoiceCreate";

const input: React.CSSProperties = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13.5, fontFamily: "inherit" };
const errStyle: React.CSSProperties = { fontSize: 12, color: "var(--bad)" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function NewInvoiceForm({ tenantId }: { tenantId: string }) {
  const t = useTranslations("adminInvoiceNew");
  const formError = useFormError("invoice");
  const [form, setForm] = useState<InvoiceForm>({ periodMonth: "", items: [emptyItem()], gstEnabled: false, gst: emptyGst() });
  const [errors, setErrors] = useState<InvoiceFormErrors>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; id?: string } | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const totals = invoiceTotals(form.items);

  const err = (k: string) => (errors[k] ? t(errors[k]) : undefined);
  const setItem = (i: number, patch: Partial<InvoiceItemForm>) => {
    setForm((f) => ({ ...f, items: f.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
    setIdempotencyKey(crypto.randomUUID());
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = validateInvoiceForm(form);
    setErrors(v);
    if (Object.keys(v).length > 0) return;
    setResult(null);
    setConfirmOpen(true);
  }

  async function confirm() {
    if (busy) return;
    setBusy(true);
    formError.clear();
    try {
      const res = await fetch("/api/proxy/v1/billing/invoices", {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": idempotencyKey },
        body: JSON.stringify(buildInvoiceBody(tenantId, form)),
      });
      setConfirmOpen(false);
      if (!res.ok) {
        const body = (await res.clone().json().catch(() => null)) as { code?: string } | null;
        setResult({ ok: false, text: body?.code === "INVOICE_PERIOD_EXISTS" ? t("periodExists") : (await formError.fromResponse(res, "save")).message });
        return;
      }
      const created = (await res.json().catch(() => null)) as { id?: unknown } | null;
      const id = typeof created?.id === "string" && UUID_RE.test(created.id) ? created.id : undefined;
      setResult({ ok: true, text: t("saved"), ...(id ? { id } : {}) });
      setIdempotencyKey(crypto.randomUUID());
    } catch (caught) {
      setConfirmOpen(false);
      setResult({ ok: false, text: formError.fromException("save", caught).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {result ? (
        <Alert variant={result.ok ? "success" : "danger"} aria-live="polite">
          {result.text}{" "}
          {result.ok ? <Link href={result.id ? `/admin/invoices/${result.id}` : "/admin/invoices"}>{result.id ? t("openDraft") : t("viewList")}</Link> : null}
        </Alert>
      ) : null}
      <div className="card">
        <form onSubmit={submit} className="pad" noValidate>
          <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start", maxWidth: 260 }}>
            <label className="l" htmlFor="inv-period">{t("period")}</label>
            <input id="inv-period" placeholder="YYYY-MM" value={form.periodMonth} style={input}
              onChange={(e) => { setForm((f) => ({ ...f, periodMonth: e.target.value })); setIdempotencyKey(crypto.randomUUID()); }}
              aria-invalid={errors.periodMonth ? true : undefined} />
            {err("periodMonth") ? <span role="alert" style={errStyle}>{err("periodMonth")}</span> : null}
          </div>

          <h3 style={{ fontSize: 14, margin: "16px 0 8px" }}>{t("items")}</h3>
          {err("items") ? <p role="alert" style={errStyle}>{err("items")}</p> : null}
          {form.items.map((it, i) => (
            <fieldset key={i} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, margin: "0 0 10px" }}>
              <legend style={{ fontSize: 12.5 }}>{t("itemLegend", { n: i + 1 })}</legend>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
                <div>
                  <label className="l" htmlFor={`inv-desc-${i}`}>{t("description")}</label>
                  <input id={`inv-desc-${i}`} value={it.description} style={input} onChange={(e) => setItem(i, { description: e.target.value })} aria-invalid={errors[`items.${i}.description`] ? true : undefined} />
                  {err(`items.${i}.description`) ? <span role="alert" style={errStyle}>{err(`items.${i}.description`)}</span> : null}
                </div>
                <div>
                  <label className="l" htmlFor={`inv-kind-${i}`}>{t("kind")}</label>
                  <select id={`inv-kind-${i}`} value={it.kind} style={input} onChange={(e) => setItem(i, { kind: e.target.value as InvoiceItemForm["kind"] })}>
                    {INVOICE_ITEM_KINDS.map((k) => <option key={k} value={k}>{t(`kind_${k}`)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="l" htmlFor={`inv-hsn-${i}`}>{t("hsnSac")}</label>
                  <input id={`inv-hsn-${i}`} value={it.hsnSac} style={input} inputMode="numeric" onChange={(e) => setItem(i, { hsnSac: e.target.value })} aria-invalid={errors[`items.${i}.hsnSac`] ? true : undefined} />
                  {err(`items.${i}.hsnSac`) ? <span role="alert" style={errStyle}>{err(`items.${i}.hsnSac`)}</span> : null}
                </div>
                <div>
                  <label className="l" htmlFor={`inv-qty-${i}`}>{t("quantity")}</label>
                  <input id={`inv-qty-${i}`} value={it.quantity} style={input} inputMode="numeric" onChange={(e) => setItem(i, { quantity: e.target.value })} aria-invalid={errors[`items.${i}.quantity`] ? true : undefined} />
                  {err(`items.${i}.quantity`) ? <span role="alert" style={errStyle}>{err(`items.${i}.quantity`)}</span> : null}
                </div>
                <div>
                  <label className="l" htmlFor={`inv-amt-${i}`}>{t("amount")}</label>
                  <input id={`inv-amt-${i}`} value={it.amount} style={input} inputMode="decimal" autoComplete="off" onChange={(e) => setItem(i, { amount: e.target.value })} aria-invalid={errors[`items.${i}.amount`] ? true : undefined} />
                  {err(`items.${i}.amount`) ? <span role="alert" style={errStyle}>{err(`items.${i}.amount`)}</span> : null}
                </div>
              </div>
              {form.items.length > 1 ? (
                <Button type="button" variant="ghost" size="sm" style={{ marginTop: 8 }} onClick={() => setForm((f) => ({ ...f, items: f.items.filter((_, j) => j !== i) }))}>
                  {t("removeItem", { n: i + 1 })}
                </Button>
              ) : null}
            </fieldset>
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={() => setForm((f) => ({ ...f, items: [...f.items, emptyItem()] }))}>{t("addItem")}</Button>

          <div style={{ margin: "16px 0 8px" }}>
            <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 13.5 }}>
              <input type="checkbox" checked={form.gstEnabled} onChange={(e) => setForm((f) => ({ ...f, gstEnabled: e.target.checked }))} />
              {t("gstToggle")}
            </label>
          </div>
          {form.gstEnabled ? (
            <fieldset style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}>
              <legend style={{ fontSize: 12.5 }}>{t("gstLegend")}</legend>
              {err("gst") ? <p role="alert" style={errStyle}>{err("gst")}</p> : null}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
                {(["supplierGstin", "recipientGstin", "placeOfSupply", "cgst", "sgst", "igst"] as const).map((k) => (
                  <div key={k}>
                    <label className="l" htmlFor={`inv-gst-${k}`}>{t(`gst_${k}`)}</label>
                    <input id={`inv-gst-${k}`} value={form.gst[k]} style={input}
                      onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, gst: { ...f.gst, [k]: v } })); }}
                      aria-invalid={errors[`gst.${k}`] ? true : undefined} />
                    {err(`gst.${k}`) ? <span role="alert" style={errStyle}>{err(`gst.${k}`)}</span> : null}
                  </div>
                ))}
              </div>
            </fieldset>
          ) : null}

          <p style={{ fontSize: 13.5, margin: "14px 0 0" }} data-testid="invoice-total">{t("total", { amount: formatMoney(totals.totalMinor) })}</p>
          <Button type="submit" disabled={busy} aria-busy={busy} style={{ marginTop: 12 }}>{t("submit")}</Button>
        </form>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        description={t("confirmBody", { period: form.periodMonth.trim(), amount: formatMoney(totals.totalMinor) })}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        onConfirm={() => { void confirm(); }}
        onCancel={() => { if (!busy) setConfirmOpen(false); }}
      />
    </>
  );
}
