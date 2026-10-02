"use client";

/**
 * GAP-FINANCE-EXPENDITURE-BILLS-01: New Bill. Replaces the one-line
 * "+ New Bill" reason dialog that POSTed { reason, status: "pending" } (which
 * finance-service's createBillBody rejects: no vendor, head, DDO or amount).
 * Collects the fields createBillBody requires, validates them client-side,
 * confirms the vendor + amount before POSTing, and sends an
 * x-idempotency-key so a double click creates one bill.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { formatMoney } from "@/lib/formatters";
import { buildCreateBillRequest, type BillFormInput } from "@/lib/finance/billForm";

export interface BillFormOption {
  id: string;
  label: string;
}

const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const errStyle = { fontSize: 12, color: "#b91c1c" } as const;

export function BillForm({
  vendors,
  heads,
  ddos,
}: {
  vendors: BillFormOption[];
  heads: BillFormOption[];
  ddos: BillFormOption[];
}) {
  const t = useTranslations("financeBillForm");
  const router = useRouter();
  const formError = useFormError("bill");
  const [form, setForm] = useState<BillFormInput>({
    billNo: "", vendorId: "", headId: "", ddoCode: ddos.length === 1 ? ddos[0].id : "", amountRupees: "", billDate: "", poRef: "", grnRef: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof BillFormInput, string>>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState("");
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const built = buildCreateBillRequest(form);
  const vendorName = vendors.find((v) => v.id === form.vendorId)?.label ?? "";

  function set<K extends keyof BillFormInput>(key: K, value: BillFormInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    formError.clear();
    setMessage("");
    const r = buildCreateBillRequest(form);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    setConfirmOpen(true);
  }

  async function submit() {
    const r = buildCreateBillRequest(form);
    if (!r.ok) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await fetch("/api/proxy/v1/finance/bills", {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": idempotencyKey },
        body: JSON.stringify(r.body),
      });
      if (!(res.ok || res.status === 202)) {
        setDialogError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setDone(true);
      setConfirmOpen(false);
      setMessage(t("success"));
      router.refresh();
      setTimeout(() => router.push("/finance/expenditure/bills"), 700);
    } catch {
      setDialogError(formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  const fe = (k: keyof BillFormInput) => {
    const key = errors[k];
    return key ? t(`err.${key}`) : formError.fieldError(k === "amountRupees" ? "grossMinor" : k);
  };

  return (
    <>
      {message ? <div role="status" className="banner" style={{ background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div> : null}
      <div className="card">
        <form onSubmit={onSubmit} className="pad" noValidate>
          <div className="fields">
            <Field id="bill-no" label={t("labelBillNo")} error={fe("billNo")}>
              <input id="bill-no" value={form.billNo} onChange={(e) => set("billNo", e.target.value)} style={inputStyle} aria-invalid={fe("billNo") ? true : undefined} />
            </Field>
            <Field id="bill-vendor" label={t("labelVendor")} error={fe("vendorId")}>
              <select id="bill-vendor" value={form.vendorId} onChange={(e) => set("vendorId", e.target.value)} style={inputStyle}>
                <option value="">{t("selectVendor")}</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </Field>
            <Field id="bill-head" label={t("labelHead")} error={fe("headId")}>
              <select id="bill-head" value={form.headId} onChange={(e) => set("headId", e.target.value)} style={inputStyle}>
                <option value="">{t("selectHead")}</option>
                {heads.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
              </select>
            </Field>
            <Field id="bill-ddo" label={t("labelDdo")} error={fe("ddoCode")}>
              <select id="bill-ddo" value={form.ddoCode} onChange={(e) => set("ddoCode", e.target.value)} style={inputStyle}>
                <option value="">{t("selectDdo")}</option>
                {ddos.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </Field>
            <Field id="bill-amount" label={t("labelAmount")} error={fe("amountRupees")}>
              <input id="bill-amount" inputMode="decimal" value={form.amountRupees} onChange={(e) => set("amountRupees", e.target.value)} style={inputStyle} aria-invalid={fe("amountRupees") ? true : undefined} />
              {built.ok ? <span style={{ fontSize: 12, color: "var(--ink2)" }}>{formatMoney(built.body.grossMinor)}</span> : null}
            </Field>
            <Field id="bill-date" label={t("labelBillDate")} error={fe("billDate")}>
              <input id="bill-date" type="date" value={form.billDate} onChange={(e) => set("billDate", e.target.value)} style={inputStyle} />
            </Field>
            <Field id="bill-po" label={t("labelPo")} error={fe("poRef")}>
              <input id="bill-po" value={form.poRef} onChange={(e) => set("poRef", e.target.value)} style={inputStyle} />
            </Field>
            <Field id="bill-grn" label={t("labelGrn")} error={fe("grnRef")}>
              <input id="bill-grn" value={form.grnRef} onChange={(e) => set("grnRef", e.target.value)} style={inputStyle} />
            </Field>
          </div>
          <Button type="submit" disabled={busy || done} aria-busy={busy} style={{ marginTop: 12 }}>
            {busy ? t("submitting") : t("review")}
          </Button>
        </form>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        description={t("confirmDescription", {
          billNo: form.billNo,
          vendor: vendorName,
          amount: built.ok ? formatMoney(built.body.grossMinor) : "—",
        })}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        {...(dialogError ? { errorMessage: dialogError } : {})}
        onConfirm={() => { void submit(); }}
        onCancel={() => { setConfirmOpen(false); setDialogError(undefined); }}
      />
    </>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string | undefined; children: React.ReactNode }) {
  return (
    <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
      <label className="l" htmlFor={id}>{label}</label>
      {children}
      {error ? <span role="alert" style={errStyle}>{error}</span> : null}
    </div>
  );
}
