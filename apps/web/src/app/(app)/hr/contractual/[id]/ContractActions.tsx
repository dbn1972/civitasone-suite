"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, Field } from "../../../../_components/ds";
import { canRenew, canTerminate, validateNewEndDate } from "../contractRules";

/**
 * GAP-HR-CONTRACTUAL-05: Renew / Terminate for one contract. Both POSTs
 * return 202 (queue-backed, F3), so on success we show "submitted" and
 * refresh rather than claiming the change has landed. The backend enforces
 * roles, status guards and writes the audit event (contracts/consumer.ts
 * audit "renewal_initiate" / "terminate"); this only gates which buttons show.
 */
export function ContractActions({
  contractId,
  status,
  version,
  currentEndDate,
  roles,
}: {
  contractId: string;
  status: string;
  version: number;
  currentEndDate: string;
  roles: string[];
}) {
  const t = useTranslations("contractualDetail");
  const router = useRouter();
  const [mode, setMode] = useState<"renew" | "terminate" | null>(null);
  const [newEndDate, setNewEndDate] = useState("");
  const [dateError, setDateError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  const showRenew = canRenew(status, roles);
  const showTerminate = canTerminate(status, roles);
  if (!showRenew && !showTerminate) return null;

  function close() {
    setMode(null);
    setError(undefined);
    setDateError(undefined);
    setNewEndDate("");
  }

  async function post(path: string, body: Record<string, unknown>, successMsg: string) {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/contracts/${contractId}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { code?: string } | null;
        setError(
          b?.code === "RENEWAL_IN_PROGRESS"
            ? t("renewalInProgress")
            : res.status === 403
              ? t("notAllowed")
              : res.status === 409 || res.status === 422
                ? t("staleContract")
                : t("actionFailed"),
        );
        return;
      }
      close();
      setNotice(successMsg);
      router.refresh();
    } catch {
      setError(t("actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  function submitRenew(reason?: string) {
    const err = validateNewEndDate(newEndDate, currentEndDate);
    if (err) {
      setDateError(t(`dateError.${err}`));
      return;
    }
    setDateError(undefined);
    void post("renew", { newEndDate, ...(reason ? { reason } : {}) }, t("renewSubmitted"));
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8 }}>
        {showRenew && <Button variant="primary" size="sm" onClick={() => setMode("renew")}>{t("renewBtn")}</Button>}
        {showTerminate && <Button variant="danger" size="sm" onClick={() => setMode("terminate")}>{t("terminateBtn")}</Button>}
      </div>
      {notice && <p role="status" style={{ marginTop: 8, fontSize: 13 }}>{notice}</p>}

      <ConfirmDialog
        open={mode === "renew"}
        title={t("renewTitle")}
        description={
          <Field label={t("newEndDateLabel")} required error={dateError}>
            <input type="date" className="inp" value={newEndDate} min={currentEndDate} onChange={(e) => setNewEndDate(e.target.value)} />
          </Field>
        }
        confirmLabel={t("renewConfirm")}
        optionalReason
        reasonLabel={t("reasonLabel")}
        maxReasonLength={1000}
        busy={busy}
        errorMessage={error}
        onConfirm={submitRenew}
        onCancel={close}
      />
      <ConfirmDialog
        open={mode === "terminate"}
        title={t("terminateTitle")}
        description={t("terminateBody")}
        confirmLabel={t("terminateConfirm")}
        danger
        requireReason
        reasonLabel={t("reasonLabel")}
        maxReasonLength={1000}
        busy={busy}
        errorMessage={error}
        onConfirm={(reason) => void post("terminate", { version, reason }, t("terminateSubmitted"))}
        onCancel={close}
      />
    </div>
  );
}
