"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, Field, Input, Select } from "../../../../_components/ds";
import { browserFetch } from "@/lib/api/browserClient";
import { useFormError } from "@/lib/useFormError";
import {
  SIGNING_FORMATS, isValidKeyRef, overridesFromRows, toOverrideRows, usesUnsigned,
  type OverrideRow, type SigningFormat, type SigningSettings,
} from "./signingState";

/**
 * GAP-PAYROLL-DISBURSEMENT-03: "Bank file signing" settings card (payroll
 * admin / super admin). Format, per-bank overrides, encrypt-to-bank and the
 * key reference. Key status shows present/missing and a public fingerprint
 * only -- key material never reaches the browser.
 */
export function BankFileSigningForm({ settings }: { settings: SigningSettings }) {
  const t = useTranslations("bankFileSigning");
  const router = useRouter();
  const formError = useFormError("bank file signing");
  const [format, setFormat] = useState<SigningFormat>(settings.config.format);
  const [rows, setRows] = useState<OverrideRow[]>(() => toOverrideRows(settings.config.perBankOverrides));
  const [nextRowId, setNextRowId] = useState(() => rows.length + 1);
  const [encryptToBank, setEncryptToBank] = useState(settings.config.encryptToBank);
  const [keyRef, setKeyRef] = useState(settings.config.keyRef);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const encryptId = useId();

  const unsigned = usesUnsigned(format, rows);
  const formatLabel = (f: SigningFormat): string => t(`format_${f}`);
  // `none` cannot be picked in production (the server refuses it too).
  const optionDisabled = (f: SigningFormat): boolean => f === "none" && !settings.unsignedAllowed && format !== "none";

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setMessage(null);
    const folded = overridesFromRows(rows);
    if (!folded.ok) {
      setError(folded.error === "duplicate" ? t("errorDuplicateBank") : t("errorBankCode"));
      return;
    }
    if (!isValidKeyRef(keyRef.trim())) {
      setError(t("errorKeyRef"));
      return;
    }
    if (encryptToBank && unsigned) {
      setError(t("errorEncryptUnsigned"));
      return;
    }
    setConfirmOpen(true);
  }

  async function save(reason: string) {
    const folded = overridesFromRows(rows);
    if (!folded.ok) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await browserFetch("v1/payroll/bank-file-signing", {
        method: "PUT",
        body: JSON.stringify({
          format,
          perBankOverrides: folded.value,
          encryptToBank,
          keyRef: keyRef.trim(),
          reason,
        }),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setConfirmOpen(false);
      setMessage(t("savedMessage"));
      router.refresh();
    } catch {
      setError(formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  const key = settings.key;
  return (
    <form onSubmit={openConfirm}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <span className={key.present ? "pill good" : "pill bad"} role="status">
          {key.present ? t("keyPresent") : t("keyMissing")}
        </span>
        {key.fingerprint && (
          <span style={{ fontSize: 12, color: "var(--ink2)" }}>
            {t("keyFingerprint")} <span className="mono">{key.fingerprint.slice(-16).toUpperCase()}</span>
          </span>
        )}
        {!key.present && key.detail && <span style={{ fontSize: 12, color: "var(--ink2)" }}>{key.detail}</span>}
      </div>
      <p style={{ fontSize: 13, color: "var(--mut)", margin: "0 0 14px" }}>
        {settings.isDefault ? t("usingDefaultNote") : t("customNote")}
      </p>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
        <Field label={t("formatLabel")} required>
          <Select value={format} onChange={(e) => setFormat(e.target.value as SigningFormat)}>
            {SIGNING_FORMATS.map((f) => (
              <option key={f} value={f} disabled={optionDisabled(f)}>{formatLabel(f)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("keyRefLabel")} required>
          <Input value={keyRef} onChange={(e) => setKeyRef(e.target.value)} maxLength={128} spellCheck={false} />
        </Field>
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 22 }}>
          <input
            id={encryptId}
            type="checkbox"
            checked={encryptToBank}
            disabled={unsigned}
            onChange={(e) => setEncryptToBank(e.target.checked)}
            style={{ width: 18, height: 18 }}
          />
          <label htmlFor={encryptId} style={{ fontSize: 13, fontWeight: 600 }}>{t("encryptLabel")}</label>
        </div>
      </div>
      <p style={{ fontSize: 12, color: "var(--ink2)", margin: "6px 0 0" }}>{t("encryptHint")}</p>

      <fieldset style={{ border: 0, padding: 0, margin: "18px 0 0" }}>
        <legend style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{t("overridesLegend")}</legend>
        <p style={{ fontSize: 12, color: "var(--ink2)", margin: "0 0 8px" }}>{t("overridesHint")}</p>
        <div style={{ display: "grid", gap: 8 }}>
          {rows.map((r) => (
            <div key={r.rowId} style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
              <Field label={t("overrideBankLabel")} style={{ width: 120 }}>
                <Input
                  value={r.bank}
                  maxLength={4}
                  placeholder="SBIN"
                  onChange={(e) => setRows(rows.map((x) => (x.rowId === r.rowId ? { ...x, bank: e.target.value.toUpperCase() } : x)))}
                />
              </Field>
              <Field label={t("overrideFormatLabel")} style={{ minWidth: 220 }}>
                <Select
                  value={r.format}
                  onChange={(e) => setRows(rows.map((x) => (x.rowId === r.rowId ? { ...x, format: e.target.value as SigningFormat } : x)))}
                >
                  {SIGNING_FORMATS.map((f) => (
                    <option key={f} value={f} disabled={optionDisabled(f) && r.format !== f}>{formatLabel(f)}</option>
                  ))}
                </Select>
              </Field>
              <Button type="button" variant="ghost" style={{ minHeight: 44 }} onClick={() => setRows(rows.filter((x) => x.rowId !== r.rowId))}>
                {t("removeOverrideBtn")}
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="secondary"
          style={{ minHeight: 44, marginTop: 8 }}
          onClick={() => { setRows([...rows, { rowId: nextRowId, bank: "", format: "pkcs7_detached" }]); setNextRowId(nextRowId + 1); }}
        >
          {t("addOverrideBtn")}
        </Button>
      </fieldset>

      {unsigned && (
        <p role="note" className="pill warn" style={{ marginTop: 14, width: "fit-content", maxWidth: "100%" }}>
          {t("unsignedWarning")}
        </p>
      )}
      {!settings.unsignedAllowed && (
        <p style={{ fontSize: 12, color: "var(--ink2)", marginTop: 10 }}>{t("productionNote")}</p>
      )}

      <div style={{ marginTop: 14 }}>
        <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={busy}>{t("saveBtn")}</Button>
      </div>
      {error && !confirmOpen && (
        <p role="alert" className="pill bad" style={{ marginTop: 10, width: "fit-content", maxWidth: "100%" }}>{error}</p>
      )}
      {message && (
        <p role="status" className="pill good" style={{ marginTop: 10, width: "fit-content" }}>{message}</p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        confirmLabel={t("confirmLabel")}
        danger={unsigned}
        busy={busy}
        errorMessage={error}
        description={unsigned ? t("confirmDescriptionUnsigned") : t("confirmDescription")}
        requireReason
        minReasonLength={10}
        maxReasonLength={500}
        reasonLabel={t("confirmReasonLabel")}
        onConfirm={(reason) => void save(reason ?? "")}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
