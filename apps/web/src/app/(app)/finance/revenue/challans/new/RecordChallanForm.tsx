"use client";

/**
 * GAP-FINANCE-REVENUE-CHALLANS-06: record a challan (receipts register entry).
 * POST /v1/finance/challans (finance_officer / finance_admin / super_admin). finance-service
 * allocates the gapless challan number, posts the receipt to the GL and the cash book, and
 * audits it. The amount is entered in rupees and converted to integer paise without float math.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { formatMoney } from "@/lib/formatters";
import { rupeesToMinorString } from "@/lib/money";
import { challanPayload, validateChallan, type ChallanErrors } from "./challanForm";

export type ReceiptHeadOption = { id: string; code: string; name: string };

const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const errStyle = { fontSize: 12, color: "#b91c1c" } as const;

export function RecordChallanForm({ heads }: { heads: ReceiptHeadOption[] }) {
  const t = useTranslations("financeChallansNew");
  const router = useRouter();
  const formError = useFormError("challan");
  const [form, setForm] = useState({ receiptHeadId: "", depositor: "", amount: "", grnNo: "" });
  const [errors, setErrors] = useState<ChallanErrors>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [done, setDone] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const errText = (e?: "required" | "amount") => (e === undefined ? undefined : e === "required" ? t("errRequired") : t("errAmount"));

  function review(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    formError.clear();
    const found = validateChallan(form);
    setErrors(found);
    if (Object.keys(found).length === 0) setConfirmOpen(true);
  }

  async function submit() {
    setBusy(true);
    setMessage("");
    setIsError(false);
    try {
      const res = await fetch("/api/proxy/v1/finance/challans", {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": idempotencyKey },
        body: JSON.stringify(challanPayload(form)),
      });
      setConfirmOpen(false);
      if (!(res.ok || res.status === 202)) {
        setIsError(true);
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      setDone(true);
      setIdempotencyKey(crypto.randomUUID());
      setMessage(t("recorded"));
      router.refresh();
      setTimeout(() => router.push("/finance/revenue/challans"), 700);
    } catch {
      setConfirmOpen(false);
      setIsError(true);
      setMessage(formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  const head = heads.find((h) => h.id === form.receiptHeadId);
  return (
    <>
      {message ? (
        <div role={isError ? "alert" : "status"} aria-live={isError ? "assertive" : "polite"} className="banner" style={{ background: isError ? "#fef2f2" : "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      <div className="card">
        <form onSubmit={review} className="pad" noValidate>
          <div className="fields">
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="chl-head">{t("labelHead")}</label>
              <select id="chl-head" required aria-invalid={errors.receiptHeadId ? true : undefined} value={form.receiptHeadId} onChange={(e) => setForm({ ...form, receiptHeadId: e.target.value })} style={inputStyle}>
                <option value="">{t("selectHead")}</option>
                {heads.map((h) => <option key={h.id} value={h.id}>{h.code} — {h.name}</option>)}
              </select>
              {errors.receiptHeadId ? <span role="alert" style={errStyle}>{errText(errors.receiptHeadId)}</span> : null}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="chl-depositor">{t("labelDepositor")}</label>
              <input id="chl-depositor" required maxLength={200} aria-invalid={errors.depositor ? true : undefined} value={form.depositor} onChange={(e) => setForm({ ...form, depositor: e.target.value })} style={inputStyle} />
              {errors.depositor ? <span role="alert" style={errStyle}>{errText(errors.depositor)}</span> : null}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="chl-amt">{t("labelAmount")}</label>
              <input id="chl-amt" required type="text" inputMode="decimal" autoComplete="off" aria-invalid={errors.amount ? true : undefined} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={inputStyle} />
              {errors.amount ? <span role="alert" style={errStyle}>{errText(errors.amount)}</span> : null}
              {formError.fieldError("amountMinor") ? <span style={errStyle}>{formError.fieldError("amountMinor")}</span> : null}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="chl-grn">{t("labelGrn")}</label>
              <input id="chl-grn" maxLength={64} value={form.grnNo} onChange={(e) => setForm({ ...form, grnNo: e.target.value })} style={inputStyle} />
            </div>
          </div>
          <p style={{ fontSize: 12, color: "var(--ink2)" }}>{t("numberHint")}</p>
          <Button type="submit" disabled={busy || done} aria-busy={busy} style={{ marginTop: 12 }}>
            {busy ? t("saving") : t("submit")}
          </Button>
        </form>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        description={t("confirmDescription", {
          depositor: form.depositor.trim(),
          amount: formatMoney(rupeesToMinorString(form.amount) ?? "0"),
          head: head ? `${head.code} — ${head.name}` : "",
        })}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        onConfirm={() => { void submit(); }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
