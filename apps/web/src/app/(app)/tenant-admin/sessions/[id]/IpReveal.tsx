"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

/**
 * OWNER DECISION #21 (TENANT-ADMIN-SESSIONS-DETAIL-05): the session's source IP
 * is shown masked. A security admin may reveal it with a reason; identity-service
 * records the reveal in the audit log BEFORE it returns the address. Other admin
 * roles get no control at all (the server would refuse them anyway).
 */
export function IpReveal({ sessionId, maskedIp, canReveal }: { sessionId: string; maskedIp: string; canReveal: boolean }) {
  const t = useTranslations("tenantW3.session");
  const formError = useFormError("session");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [clear, setClear] = useState<string | null>(null);

  async function reveal(reason?: string) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    formError.clear();
    try {
      const res = await fetch(`/api/proxy/identity/sessions/${sessionId}/reveal-ip`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "load")).message);
        return;
      }
      const body = (await res.json()) as { ipAddress: string };
      setClear(body.ipAddress);
      setOpen(false);
    } catch (caught) {
      setError(formError.fromException("load", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span className="mono" aria-label={clear ? t("ipRevealed") : t("ipMasked")}>{clear ?? maskedIp}</span>
      {canReveal ? (
        clear ? (
          <Button variant="ghost" style={{ minHeight: 44, minWidth: 44 }} onClick={() => setClear(null)}>{t("hide")}</Button>
        ) : (
          <Button variant="ghost" style={{ minHeight: 44, minWidth: 44 }} onClick={() => { setError(undefined); setOpen(true); }}>{t("reveal")}</Button>
        )
      ) : null}
      <ConfirmDialog
        open={open}
        title={t("dialogTitle")}
        description={t("dialogBody")}
        confirmLabel={t("reveal")}
        requireReason
        minReasonLength={10}
        maxReasonLength={500}
        reasonLabel={t("reasonLabel")}
        busy={busy}
        {...(error ? { errorMessage: error } : {})}
        onConfirm={(reason) => void reveal(reason)}
        onCancel={() => { if (!busy) { setOpen(false); setError(undefined); } }}
      />
    </span>
  );
}
