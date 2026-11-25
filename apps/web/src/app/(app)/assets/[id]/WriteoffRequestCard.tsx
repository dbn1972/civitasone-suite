"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog } from "../../../_components/ds";
import { requestWriteoff } from "../condemnation/writeoffApi";

/**
 * UAT W4: raise a write-off request for this asset
 * (POST /v1/assets/assets/:id/writeoff-request -- ASSET_ROLES; 202). The request
 * changes nothing on the asset; a DIFFERENT approver (asset_admin /
 * super_admin / finance_officer) must approve it. The reference returned by the
 * service is shown so the maker can pass it to the approver.
 */
export function WriteoffRequestCard({ assetId, assetCode }: { assetId: string; assetCode: string }) {
  const t = useTranslations("assetsLifecycle");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [reference, setReference] = useState<string | null>(null);

  async function confirm(remarks?: string) {
    setBusy(true);
    setError(undefined);
    try {
      const r = await requestWriteoff(assetId, remarks);
      if (!r.ok) { setError(r.key ? t(`wo_${r.key}`) : r.message); return; }
      setReference(r.id);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-h"><h3>{t("woRequestTitle")}</h3></div>
      <div className="pad" style={{ display: "grid", gap: 10 }}>
        <p style={{ margin: 0 }}>{t("woRequestIntro")}</p>
        {reference ? (
          <p role="status" className="pill good" style={{ width: "fit-content" }}>
            {t("woRequestSubmitted", { reference })}
          </p>
        ) : null}
        <div>
          <Button type="button" variant="secondary" onClick={() => { setError(undefined); setOpen(true); }}>{t("woRequestButton")}</Button>
        </div>
      </div>
      <ConfirmDialog
        open={open}
        title={t("woRequestDialogTitle", { asset: assetCode })}
        description={t("woRequestDialogBody")}
        confirmLabel={t("woRequestConfirm")}
        cancelLabel={t("cancel")}
        optionalReason
        reasonLabel={t("woRemarks")}
        busy={busy}
        errorMessage={error}
        onConfirm={(remarks) => void confirm(remarks)}
        onCancel={() => !busy && setOpen(false)}
      />
    </div>
  );
}
