"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Modal, Button, StatusPill } from "@/app/_components/ds";
import { formatMoney, formatIndianDateTime } from "@/lib/formatters";
import { useFormError } from "@/lib/useFormError";

type Fee = {
  id: string;
  status: string;
  amountMinor: string;
  currency: string;
  exemptionReason?: string;
  provider: string;
  paymentRef?: string;
  paidAt?: string;
};

type Load = { kind: "loading" } | { kind: "none" } | { kind: "error" } | { kind: "ready"; fee: Fee };

const inputClass = "w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500";

/**
 * GAP-RECRUITMENT-DETAIL-13 (application fee status): shows the fee assessed for one application and
 * lets HR assess it and record an OFFLINE payment (challan / DD / UTR reference). Money is paise on the
 * wire (amountMinor, a string); an exemption by reserved category only applies once the category claim is
 * marked verified, because a self-declared category alone must never waive a fee.
 */
export function ApplicationFeeDialog({ applicationId, applicantName, onClose }: { applicationId: string; applicantName: string; onClose: () => void }) {
  const t = useTranslations("recruitmentFinish");
  const formError = useFormError("application fee");
  const uid = useId();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [categoryVerified, setCategoryVerified] = useState(false);
  const [paymentRef, setPaymentRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const read = useCallback(async () => {
    try {
      const res = await fetch(`/api/proxy/v1/hrms/applications/${applicationId}/fee`);
      if (res.status === 404) { if (mounted.current) setLoad({ kind: "none" }); return; }
      if (!res.ok) { if (mounted.current) setLoad({ kind: "error" }); return; }
      const j = (await res.json()) as { data?: Fee };
      if (mounted.current) setLoad(j.data ? { kind: "ready", fee: j.data } : { kind: "error" });
    } catch {
      if (mounted.current) setLoad({ kind: "error" });
    }
  }, [applicationId]);

  useEffect(() => { void read(); }, [read]);

  async function send(path: string, body: unknown, okText: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/applications/${applicationId}/fee/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const env = (await res.clone().json().catch(() => null)) as { code?: string } | null;
        const text = env?.code === "FORBIDDEN" ? t("feeForbidden")
          : env?.code === "NOT_PAYABLE" || env?.code === "FEE_EXEMPT" ? t("feeNotPayable")
          : (await formError.fromResponse(res, "save")).message;
        setMessage({ kind: "error", text });
        return;
      }
      setMessage({ kind: "ok", text: okText });
      setPaymentRef("");
      await read();
      setTimeout(() => { if (mounted.current) void read(); }, 1200);
    } catch (caught) {
      setMessage({ kind: "error", text: formError.fromException("save", caught).message });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t("feeTitle", { name: applicantName })} size="md">
      <div className="flex flex-col gap-3">
        {load.kind === "loading" && <p role="status" className="text-sm text-slate-500">{t("feeLoading")}</p>}
        {load.kind === "error" && (
          <p role="alert" className="text-sm text-red-600">
            {t("feeLoadFailed")} <button type="button" className="underline" onClick={() => { setLoad({ kind: "loading" }); void read(); }}>{t("retry")}</button>
          </p>
        )}

        {load.kind === "none" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">{t("feeNotAssessed")}</p>
            <label className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-200">
              <input type="checkbox" checked={categoryVerified} onChange={(e) => setCategoryVerified(e.target.checked)} className="mt-0.5" />
              <span>{t("feeCategoryVerified")}</span>
            </label>
            <div className="flex justify-end">
              <Button disabled={busy} onClick={() => void send("assess", { categoryVerified }, t("feeAssessed"))}>{t("feeAssess")}</Button>
            </div>
          </div>
        )}

        {load.kind === "ready" && (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800 dark:text-slate-100">{formatMoney(load.fee.amountMinor)}</span>
                <StatusPill status={load.fee.status} />
              </div>
              {load.fee.exemptionReason && <p className="mt-1 text-xs text-slate-500">{t("feeExemptReason", { reason: load.fee.exemptionReason })}</p>}
              {load.fee.paymentRef && <p className="mt-1 text-xs text-slate-500">{t("feePaidRef", { ref: load.fee.paymentRef })}{load.fee.paidAt ? ` · ${formatIndianDateTime(load.fee.paidAt)}` : ""}</p>}
            </div>
            {load.fee.status === "pending" && (
              <form
                className="flex flex-col gap-2"
                onSubmit={(e) => { e.preventDefault(); if (paymentRef.trim()) void send("pay", { mode: "manual", paymentRef: paymentRef.trim() }, t("feePaymentRecorded")); }}
              >
                <label htmlFor={`${uid}-ref`} className="block text-xs font-semibold text-slate-600 dark:text-slate-300">{t("feePaymentRef")}</label>
                <input id={`${uid}-ref`} className={inputClass} maxLength={128} value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} placeholder={t("feePaymentRefPlaceholder")} required />
                <p className="text-[11px] text-slate-500">{t("feeOfflineNote")}</p>
                <div className="flex justify-end">
                  <Button type="submit" disabled={busy || paymentRef.trim() === ""}>{t("feeRecordPayment")}</Button>
                </div>
              </form>
            )}
          </div>
        )}

        {message && <p role={message.kind === "error" ? "alert" : "status"} className={`text-xs ${message.kind === "error" ? "text-red-600" : "text-emerald-700"}`}>{message.text}</p>}
        <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>{t("close")}</Button></div>
      </div>
    </Modal>
  );
}
