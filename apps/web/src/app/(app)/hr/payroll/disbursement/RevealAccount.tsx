"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, Masked } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type RevealResponse = { data: { accountNumber: string; ifsc: string; visibleSeconds: number } };

/** Fallback if the API omits visibleSeconds. */
const DEFAULT_VISIBLE_SECONDS = 30;

type Props = {
  transferId: string;
  /** Last 4 digits (what the list API sends). Null when the ledger has no account. */
  last4: string | null;
  employeeName: string;
  /** Payroll roles only; without it the number can only ever be seen masked. */
  canReveal: boolean;
};

/**
 * GAP-PAYROLL-DISBURSEMENT-01: masked bank account with an AUDITED reveal.
 *
 * Revealing needs a reason (min 10 chars); the server records actor, reason
 * and transfer in the audit log BEFORE it returns the number, so a reveal
 * that cannot be audited does not happen. The number is held only in this
 * component's state, hidden again after the server-stated number of seconds
 * (30), on unmount, and on demand.
 */
export function RevealAccount({ transferId, last4, employeeName, canReveal }: Props) {
  const t = useTranslations("disbursementTransferTable");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [revealed, setRevealed] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function hide() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setRevealed(null);
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function reveal(reason: string) {
    setBusy(true);
    setError(undefined);
    try {
      const res = await browserJson<RevealResponse>(
        "v1/payroll/disbursement/transfers/" + encodeURIComponent(transferId) + "/reveal-account",
        { method: "POST", body: JSON.stringify({ reason }) },
      );
      setRevealed(res.data.accountNumber);
      setOpen(false);
      if (timer.current) clearTimeout(timer.current);
      const seconds = res.data.visibleSeconds > 0 ? res.data.visibleSeconds : DEFAULT_VISIBLE_SECONDS;
      timer.current = setTimeout(hide, seconds * 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("revealError"));
    } finally {
      setBusy(false);
    }
  }

  const masked = (
    <Masked
      kind="account"
      value={last4 ? `XXXX${last4}` : null}
      ariaLabel={last4 ? t("accountEndingAria", { last4 }) : undefined}
      fallback={<span style={{ color: "var(--ink2)" }}>—</span>}
    />
  );

  if (!last4 || !canReveal) return masked;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {revealed ? (
        <>
          <span className="mono" role="status" aria-label={t("revealedAria", { name: employeeName })}>{revealed}</span>
          <Button type="button" variant="ghost" size="sm" style={{ minHeight: 28, fontSize: 11 }} onClick={hide}>
            {t("hideBtn")}
          </Button>
        </>
      ) : (
        <>
          {masked}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            style={{ minHeight: 28, fontSize: 11 }}
            aria-label={t("revealAria", { name: employeeName })}
            onClick={() => { setError(undefined); setOpen(true); }}
          >
            {t("revealBtn")}
          </Button>
        </>
      )}
      <ConfirmDialog
        open={open}
        title={t("revealTitle")}
        confirmLabel={t("revealConfirm")}
        busy={busy}
        errorMessage={error}
        requireReason
        minReasonLength={10}
        maxReasonLength={500}
        reasonLabel={t("revealReasonLabel")}
        description={t("revealDescription", { name: employeeName })}
        onConfirm={(reason) => void reveal(reason ?? "")}
        onCancel={() => !busy && setOpen(false)}
      />
    </span>
  );
}
