"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

/**
 * GAP-PAYROLL-ARREARS-03: per-tenant switch, default ON. ON => the payroll run
 * pays only APPROVED manual arrears and approval needs a second person. OFF is
 * the pre-existing behaviour (pending arrears are paid). Changing it needs a
 * reason and is audited (PUT /v1/payroll/arrears/approval-policy).
 */
export function ArrearPolicyCard({ required }: { required: boolean }) {
  const t = useTranslations("arrearPolicy");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  async function apply(reason?: string) {
    setBusy(true);
    setError(undefined);
    try {
      await browserJson("v1/payroll/arrears/approval-policy", {
        method: "PUT",
        body: JSON.stringify({ required: !required, reason }),
      });
      setOpen(false);
      setMessage(t("savedMessage"));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("title")} padding>
      <p style={{ margin: "0 0 10px", fontSize: 13 }}>{required ? t("onDescription") : t("offDescription")}</p>
      <Button type="button" variant="secondary" onClick={() => { setError(undefined); setOpen(true); }}>
        {required ? t("turnOff") : t("turnOn")}
      </Button>
      {message && <p role="status" className="pill good" style={{ width: "fit-content", marginTop: 10 }}>{message}</p>}
      <ConfirmDialog
        open={open}
        title={required ? t("turnOffTitle") : t("turnOnTitle")}
        description={required ? t("turnOffWarning") : t("turnOnWarning")}
        confirmLabel={required ? t("turnOff") : t("turnOn")}
        danger={required}
        requireReason
        minReasonLength={10}
        maxReasonLength={500}
        reasonLabel={t("reasonLabel")}
        busy={busy}
        errorMessage={error}
        onConfirm={(reason) => void apply(reason)}
        onCancel={() => !busy && setOpen(false)}
      />
    </Card>
  );
}
