"use client";

/**
 * GAP-FINANCE-VENDORS-DETAIL-04: vendor bank-detail change is a payment-diversion control point, so it
 * is a REQUEST (maker) decided by a DIFFERENT user (checker). finance-service refuses a direct bank
 * edit while the check is on, enforces maker != checker and one open request per vendor, and audits
 * every step. This component renders the pending-approval banner (with Approve / Reject for approvers)
 * or, when nothing is pending, the "Propose bank change" form. Account numbers are shown masked only.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ActionButton, Button, ConfirmDialog } from "@/app/_components/ds";
import { browserFetch } from "@/lib/api/browserClient";
import { workflowErrorMessage } from "@/lib/finance/workflowErrors";
import { validateBankChange, type BankChangeForm } from "@/lib/finance/vendorBankChange";
import { useSettledRefresh } from "@/lib/finance/useSettledRefresh";

export type PendingBankChange = {
  id: string;
  bankName: string;
  ifsc: string;
  accountMasked: string;
  reason: string;
  proposedByName: string;
  proposedAtLabel: string;
  proposedByMe: boolean;
};

const EMPTY: BankChangeForm = { bankName: "", bankAccount: "", ifsc: "", reason: "" };
const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;

export function VendorBankChange({
  vendorId, vendorName, pending, canPropose, canDecide,
}: { vendorId: string; vendorName: string; pending: PendingBankChange | null; canPropose: boolean; canDecide: boolean }) {
  const t = useTranslations("financeVendorBankChange");
  const te = useTranslations("financeWorkflowErrors");
  const router = useRouter();
  const settle = useSettledRefresh(router);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<BankChangeForm>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof BankChangeForm, string>>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);
  const [note, setNote] = useState<string | null>(null);
  const idemKey = useRef(globalThis.crypto.randomUUID());

  async function call(path: string, body: object): Promise<void> {
    const res = await browserFetch(path, { method: "POST", headers: { "x-idempotency-key": idemKey.current }, body: JSON.stringify(body) });
    if (!res.ok) {
      idemKey.current = globalThis.crypto.randomUUID();
      throw new Error(await workflowErrorMessage(res, (k) => te(k), "save", "vendor bank change"));
    }
  }

  function review(e: React.FormEvent) {
    e.preventDefault();
    const r = validateBankChange(form);
    if (!r.ok) {
      setErrors(Object.fromEntries(Object.entries(r.errors).map(([k, v]) => [k, t(`err.${v}`)])));
      return;
    }
    setErrors({});
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function submit() {
    const r = validateBankChange(form);
    if (!r.ok) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      await call(`v1/finance/vendors/${vendorId}/bank-change`, r.body);
      setConfirmOpen(false);
      setOpen(false);
      setForm(EMPTY);
      idemKey.current = globalThis.crypto.randomUUID();
      setNote(t("proposed"));
      settle();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  const built = validateBankChange(form);
  return (
    <section aria-label={t("heading")} style={{ marginTop: 16 }}>
      {pending ? (
        <div role="status" className="banner" style={{ background: "#fffaeb", padding: 12, borderRadius: 12, fontSize: 13 }}>
          <strong>{t("pendingTitle")}</strong>
          <p style={{ margin: "6px 0" }}>
            {t("pendingBody", { bank: pending.bankName, ifsc: pending.ifsc, account: pending.accountMasked, by: pending.proposedByName, on: pending.proposedAtLabel })}
          </p>
          <p style={{ margin: "6px 0" }}>{t("pendingReason", { reason: pending.reason })}</p>
          {canDecide ? (
            pending.proposedByMe ? (
              <span role="note" style={{ color: "var(--mut)" }}>{t("cannotDecideOwn")}</span>
            ) : (
              <span style={{ display: "inline-flex", gap: 8 }}>
                <ActionButton
                  label={t("approveLabel")}
                  className="btn primary"
                  confirmTitle={t("approveTitle", { name: vendorName })}
                  confirmDescription={t("approveDescription")}
                  confirmLabel={t("approveConfirm")}
                  onConfirm={() => call(`v1/finance/vendors/${vendorId}/bank-change/${pending.id}/approve`, {})}
                  onSuccess={() => { setNote(t("approved")); settle(); }}
                />
                <ActionButton
                  label={t("rejectLabel")}
                  className="btn ghost"
                  danger
                  confirmTitle={t("rejectTitle", { name: vendorName })}
                  confirmDescription={t("rejectDescription")}
                  confirmLabel={t("rejectConfirm")}
                  requireReason
                  reasonLabel={t("reasonLabel")}
                  minReasonLength={5}
                  maxReasonLength={500}
                  onConfirm={(reason) => call(`v1/finance/vendors/${vendorId}/bank-change/${pending.id}/reject`, { reason })}
                  onSuccess={() => { setNote(t("rejected")); settle(); }}
                />
              </span>
            )
          ) : null}
        </div>
      ) : canPropose ? (
        <>
          <Button variant="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? t("cancel") : t("proposeLabel")}</Button>
          {open ? (
            <form onSubmit={review} noValidate className="card pad" style={{ marginTop: 12 }}>
              <p style={{ fontSize: 13, color: "var(--mut)", marginTop: 0 }}>{t("proposeIntro")}</p>
              <div className="fields">
                {(["bankName", "bankAccount", "ifsc", "reason"] as const).map((k) => (
                  <div key={k} className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                    <label className="l" htmlFor={`bank-change-${k}`}>{t(`label.${k}`)}</label>
                    <input
                      id={`bank-change-${k}`}
                      value={form[k]}
                      autoComplete="off"
                      onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                      aria-invalid={errors[k] ? true : undefined}
                      style={inputStyle}
                    />
                    {errors[k] ? <span role="alert" style={{ fontSize: 12, color: "#b91c1c" }}>{errors[k]}</span> : null}
                  </div>
                ))}
              </div>
              <Button type="submit" style={{ marginTop: 12 }}>{t("review")}</Button>
            </form>
          ) : null}
        </>
      ) : null}
      {note ? <p role="status" style={{ fontSize: 12 }}>{note}</p> : null}
      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle", { name: vendorName })}
        description={built.ok ? t("confirmDescription", { bank: built.body.bankName, ifsc: built.body.ifsc, last4: built.body.bankAccount.slice(-4) }) : ""}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        {...(dialogError ? { errorMessage: dialogError } : {})}
        onConfirm={() => { void submit(); }}
        onCancel={() => { if (!busy) { setConfirmOpen(false); setDialogError(undefined); } }}
      />
    </section>
  );
}
