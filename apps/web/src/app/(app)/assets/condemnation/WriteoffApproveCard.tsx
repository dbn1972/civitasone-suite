"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, Field, Input } from "../../../_components/ds";
import { UUID_RE, approveWriteoff } from "./writeoffApi";

/**
 * UAT W4: checker step of a write-off. POST /v1/assets/writeoff-requests/:id/approve
 * (WRITEOFF_APPROVER_ROLES: asset_admin / super_admin / finance_officer; 202).
 * The service refuses the maker (403 SELF_APPROVAL_FORBIDDEN, GFR Rule 173) and an
 * already-decided request (409). asset-service has no list route for write-off
 * requests, so the approver enters the reference the requester was given.
 * The page renders this card only for approver roles; the service stays authoritative.
 */
export function WriteoffApproveCard() {
  const t = useTranslations("assetsLifecycle");
  const [reference, setReference] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState("");

  function review() {
    const ref = reference.trim();
    if (!UUID_RE.test(ref)) { setFieldError(t("woRefInvalid")); return; }
    setFieldError(undefined);
    setDialogError(undefined);
    setOpen(true);
  }

  async function confirm() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const r = await approveWriteoff(reference.trim());
      if (!r.ok) { setDialogError(r.key ? t(`wo_${r.key}`) : r.message); return; }
      setMessage(t("woApproveSubmitted", { reference: reference.trim() }));
      setReference("");
      setOpen(false);
    } catch (e) {
      setDialogError(e instanceof Error ? e.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-h"><h3>{t("woApproveTitle")}</h3></div>
      <form className="pad" style={{ display: "grid", gap: 10, maxInlineSize: 520 }} onSubmit={(e) => { e.preventDefault(); review(); }} noValidate>
        <p style={{ margin: 0 }}>{t("woApproveIntro")}</p>
        <Field label={t("woRefLabel")} required error={fieldError} hint={t("woRefHint")}>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="3f2b6c1e-…" autoComplete="off" />
        </Field>
        {message ? <p role="status" className="pill good" style={{ width: "fit-content" }}>{message}</p> : null}
        <div><Button type="submit" variant="primary">{t("woApproveButton")}</Button></div>
      </form>
      <ConfirmDialog
        open={open}
        title={t("woApproveDialogTitle")}
        description={t("woApproveDialogBody", { reference: reference.trim() })}
        confirmLabel={t("woApproveConfirm")}
        cancelLabel={t("cancel")}
        danger
        busy={busy}
        errorMessage={dialogError}
        onConfirm={() => void confirm()}
        onCancel={() => !busy && setOpen(false)}
      />
    </div>
  );
}
