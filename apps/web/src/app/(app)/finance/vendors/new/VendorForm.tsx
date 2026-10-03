"use client";

/**
 * GAP-FINANCE-VENDORS-01: New Vendor. POSTs /v1/finance/vendors, which
 * finance-service restricts to finance_admin / super_admin (a 403 is shown as a
 * clerk-safe message). With the tenant's vendor approval check on (the default)
 * the vendor is saved PENDING and a different finance admin must approve it
 * before it can be paid; the response `status` decides which message is shown.
 * Vendor onboarding is a payment-diversion control point, so the officer
 * confirms the name, PAN and the last four digits of the account first.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import { maskAccount, maskPan } from "@/app/_components/ds/Masked";
import { useFormError } from "@/lib/useFormError";
import { buildCreateVendorRequest, type VendorFormInput } from "@/lib/finance/vendorForm";

const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const FIELDS: { key: keyof VendorFormInput; label: string; type?: string }[] = [
  { key: "name", label: "labelName" },
  { key: "category", label: "labelCategory" },
  { key: "pan", label: "labelPan" },
  { key: "gstin", label: "labelGstin" },
  { key: "address", label: "labelAddress" },
  { key: "contactPerson", label: "labelContactPerson" },
  { key: "phone", label: "labelPhone" },
  { key: "email", label: "labelEmail", type: "email" },
  { key: "bankName", label: "labelBankName" },
  { key: "bankAccount", label: "labelBankAccount" },
  { key: "ifsc", label: "labelIfsc" },
];

const EMPTY: VendorFormInput = {
  name: "", category: "", pan: "", gstin: "", address: "", contactPerson: "", phone: "", email: "", bankName: "", bankAccount: "", ifsc: "",
};

export function VendorForm() {
  const t = useTranslations("financeVendorForm");
  const router = useRouter();
  const formError = useFormError("vendor");
  const [form, setForm] = useState<VendorFormInput>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof VendorFormInput, string>>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"active" | "pending" | false>(false);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const r = buildCreateVendorRequest(form);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function submit() {
    const r = buildCreateVendorRequest(form);
    if (!r.ok) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await fetch("/api/proxy/v1/finance/vendors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(r.body),
      });
      if (!res.ok) {
        setDialogError((await formError.fromResponse(res, "save")).message);
        return;
      }
      const created = (await res.json().catch(() => null)) as { status?: string } | null;
      setDone(created?.status === "pending" ? "pending" : "active");
      setConfirmOpen(false);
      router.refresh();
      setTimeout(() => router.push("/finance/vendors"), 700);
    } catch {
      setDialogError(formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  const built = buildCreateVendorRequest(form);
  return (
    <>
      {done ? <div role="status" className="banner" style={{ background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{done === "pending" ? t("createdPending") : t("created")}</div> : null}
      <div className="card">
        <form onSubmit={onSubmit} className="pad" noValidate>
          <div className="fields">
            {FIELDS.map((f) => {
              const errKey = errors[f.key];
              const err = errKey ? t(`err.${errKey}`) : formError.fieldError(f.key);
              return (
                <div key={f.key} className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                  <label className="l" htmlFor={`vendor-${f.key}`}>{t(f.label)}</label>
                  <input
                    id={`vendor-${f.key}`}
                    type={f.type ?? "text"}
                    value={form[f.key]}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    style={inputStyle}
                    aria-invalid={err ? true : undefined}
                  />
                  {err ? <span role="alert" style={{ fontSize: 12, color: "#b91c1c" }}>{err}</span> : null}
                </div>
              );
            })}
          </div>
          <Button type="submit" disabled={busy || done !== false} aria-busy={busy} style={{ marginTop: 12 }}>{t("review")}</Button>
        </form>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        description={
          built.ok
            ? t("confirmDescription", { name: built.body.name, pan: maskPan(built.body.pan), account: maskAccount(built.body.bankAccount), ifsc: built.body.ifsc })
            : ""
        }
        confirmLabel={t("confirmLabel")}
        busy={busy}
        {...(dialogError ? { errorMessage: dialogError } : {})}
        onConfirm={() => { void submit(); }}
        onCancel={() => { if (!busy) { setConfirmOpen(false); setDialogError(undefined); } }}
      />
    </>
  );
}
