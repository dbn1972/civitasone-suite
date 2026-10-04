"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { browserFetch, errorCodeFromResponse } from "@/lib/api/browserClient";
import { useFormError } from "@/lib/useFormError";
import { formatMoney, formatIndianDate, daysUntilIST } from "@/lib/formatters";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import { SigningBadge } from "./SigningBadge";
import { saveResponseAsFile } from "./IssuedBankFilesTable";

/**
 * A run eligible for a bank file. API status "completed" == DB "approved"
 * (first file); "paid" == DB "disbursed" (an audited RE-ISSUE) -- see
 * payroll-service queries.ts mapRunStatus and bank-transfer/routes.ts.
 * netAmountMinor is the run's net pay in integer PAISE as a string
 * (GAP-PAYROLL-DISBURSEMENT-08): money is never carried as a float rupee.
 */
export type RunOption = {
  id: string;
  payPeriod: string;
  netAmountMinor: string;
  employeeCount: number;
  status: "completed" | "paid";
};
type Format = "csv" | "nach" | "apbs";

/**
 * What the page knows about the tenant DSC:
 *  - configured: metadata loaded
 *  - none: the API said no DSC is configured
 *  - restricted: the viewer's role cannot read DSC config (admin-only API)
 *  - unavailable: the DSC loader failed
 */
export type DscStatus =
  | { kind: "configured"; subjectCn: string; notAfter: string; sha256Fingerprint: string }
  | { kind: "none" }
  | { kind: "restricted" }
  | { kind: "unavailable" };

/**
 * Which formats the sponsor-bank config allows. `null` = unknown (config not
 * readable by this role, or failed to load) -- the server still enforces it.
 */
export type FormatAvailability = { nachEnabled: boolean | null };

const STEP_KEYS = ["stepSelectPeriod", "stepPreviewFile", "stepDscSigning", "stepDownload"] as const;

/** GAP-PAYROLL-DISBURSEMENT-03: warn this many days before the DSC expires. */
const DSC_EXPIRY_WARN_DAYS = 30;

function StepBar({ step, steps, stepsAriaLabel }: { step: number; steps: readonly string[]; stepsAriaLabel: string }) {
  return (
    <nav aria-label={stepsAriaLabel} style={{ display: "flex", marginBottom: 28 }}>
      {steps.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <div key={label} style={{ flex: 1, display: "flex", alignItems: "center" }}>
            <div style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div
                style={{
                  width: 28, height: 28, borderRadius: "50%",
                  background: done ? "var(--good, #27ae60)" : active ? "var(--accent, #2563eb)" : "var(--line2)",
                  color: done || active ? "#fff" : "var(--ink2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 700,
                }}
                aria-current={active ? "step" : undefined}
              >
                {done ? "✓" : i + 1}
              </div>
              <span style={{ fontSize: 11, marginTop: 4, color: active ? "var(--accent, #2563eb)" : "var(--ink2)", whiteSpace: "nowrap" }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{ flex: 1, height: 2, background: done ? "var(--good, #27ae60)" : "var(--line2)", margin: "0 6px", marginBottom: 20 }} />
            )}
          </div>
        );
      })}
    </nav>
  );
}

export function BankFileWizard({
  runs,
  dsc,
  availability = { nachEnabled: null },
}: {
  runs: RunOption[];
  dsc: DscStatus;
  availability?: FormatAvailability;
}) {
  const t = useTranslations("bankFileWizard");
  const [step, setStep] = useState(0);
  const [runId, setRunId] = useState(runs[0]?.id ?? "");
  // GAP-PAYROLL-DISBURSEMENT-06: default to NEFT/RTGS CSV -- the one format
  // every tenant can generate without NACH sponsor setup.
  const [format, setFormat] = useState<Format>("csv");
  const [filename, setFilename] = useState<string | null>(null);
  const [signed, setSigned] = useState<boolean | null>(null);
  // GAP-PAYROLL-DISBURSEMENT-03: what the server says it did with the file.
  const [sigFormat, setSigFormat] = useState<string | null>(null);
  const [issuanceId, setIssuanceId] = useState<string | null>(null);
  const [encrypted, setEncrypted] = useState(false);
  const [sigError, setSigError] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const formError = useFormError("bank file");

  const runSelectId = useId();
  const selectedRun = runs.find((r) => r.id === runId);

  const steps = STEP_KEYS.map((k) => t(k));
  // UX-017: moved out of module scope (it needs `t`) -- was previously a
  // top-level FORMAT_LABELS constant.
  const formatLabels: Record<Format, { label: string; desc: string; layout: string }> = {
    csv: { label: t("formatCsvLabel"), desc: t("formatCsvDesc"), layout: t("formatCsvLayout") },
    nach: { label: t("formatNachLabel"), desc: t("formatNachDesc"), layout: t("formatNachLayout") },
    apbs: { label: t("formatApbsLabel"), desc: t("formatApbsDesc"), layout: t("formatApbsLayout") },
  };
  // Why a format can't be chosen right now (null = selectable).
  const formatDisabledReason: Record<Format, string | null> = {
    csv: null,
    nach: availability.nachEnabled === false ? t("formatNachDisabled") : null,
    // payroll-service rejects every APBS request (APBS_DATA_UNAVAILABLE):
    // Aadhaar + destination-bank IIN are not captured for any beneficiary.
    apbs: t("formatApbsUnavailable"),
  };

  const dscDaysLeft = dsc.kind === "configured" ? daysUntilIST(dsc.notAfter) : null;
  const dscExpired = dscDaysLeft !== null && dscDaysLeft < 0;
  const dscExpiringSoon = dscDaysLeft !== null && !dscExpired && dscDaysLeft <= DSC_EXPIRY_WARN_DAYS;

  async function downloadFile(reason: string) {
    if (!runId) return;
    setBusy(true);
    setError(undefined);
    try {
      // GAP-PAYROLL-DISBURSEMENT-02: POST with a mandatory reason; the server
      // audits every generation (and flags a re-issue for a paid run).
      const res = await browserFetch(`v1/payroll/runs/${encodeURIComponent(runId)}/bank-file`, {
        method: "POST",
        body: JSON.stringify({ format, reason }),
      });
      if (!res.ok) {
        // Production keystore not set up yet: say so plainly (503 SIGNING_NOT_IMPLEMENTED).
        if (res.status === 503 && (await errorCodeFromResponse(res)) === "SIGNING_NOT_IMPLEMENTED") {
          setError(t("signingNotReady"));
          return;
        }
        const resolved = await formError.fromResponse(res, "save");
        setError(resolved.message);
        return;
      }
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = /filename="?([^";]+)"?/.exec(disposition);
      const contentType = res.headers.get("content-type") ?? "";
      const ext = contentType.includes("zip") ? "zip" : format === "csv" ? "csv" : "txt";
      const fn = match?.[1] ?? `bank_transfer_${runId}.${ext}`;
      // GAP-PAYROLL-DISBURSEMENT-03: only the server can say whether it
      // signed the file. Anything other than an explicit "true" is UNSIGNED.
      const isSigned = res.headers.get("x-bank-file-signed") === "true";
      const fmt = res.headers.get("x-bank-file-signature-format");
      const issuance = res.headers.get("x-bank-file-issuance-id");
      setSigned(isSigned);
      setSigFormat(fmt);
      setIssuanceId(issuance);
      setEncrypted(res.headers.get("x-bank-file-encrypted") === "true");
      setFilename(fn);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fn;
      a.click();
      URL.revokeObjectURL(url);
      setConfirmOpen(false);
      // A detached signature (.sig / .p7s) is a second download; the bank
      // needs it with the file. Best effort here -- the button on the success
      // screen fetches it again.
      if (isSigned && issuance && (fmt === "pgp_detached" || fmt === "pkcs7_detached")) {
        await downloadSignatureFor(issuance, fn);
      }
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  async function downloadSignatureFor(id: string, fileName: string) {
    try {
      const res = await browserFetch(`v1/payroll/disbursement/files/${encodeURIComponent(id)}/signature`);
      if (!res.ok) {
        setSigError(true);
        return;
      }
      setSigError(false);
      await saveResponseAsFile(res, `${fileName}.sig`);
    } catch {
      setSigError(true);
    }
  }

  if (runs.length === 0) {
    return (
      <div style={{ padding: "24px", textAlign: "center", color: "var(--ink2)" }}>
        <p style={{ fontSize: 32, margin: "0 0 8px" }}>🏦</p>
        <p style={{ fontWeight: 600 }}>{t("emptyTitle")}</p>
        <p style={{ fontSize: 13 }}>{t("emptyMessage")}</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "20px 24px" }}>
      <StepBar step={step} steps={steps} stepsAriaLabel={t("stepsAriaLabel")} />

      {/* Step 0 — Select pay period */}
      {step === 0 && (
        <div style={{ display: "grid", gap: 18 }}>
          <div>
            <label htmlFor={runSelectId} style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>
              {t("payrollRunLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <select id={runSelectId} className="input" value={runId} onChange={(e) => setRunId(e.target.value)} style={{ maxWidth: 380 }}>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.payPeriod} — {formatMoney(r.netAmountMinor)}{r.status === "paid" ? ` (${t("runPaidSuffix")})` : ""}
                </option>
              ))}
            </select>
            {selectedRun?.status === "paid" && (
              <p role="note" style={{ fontSize: 12, color: "var(--warn, #b45309)", margin: "6px 0 0" }}>
                {t("reissueNote")}
              </p>
            )}
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{t("bankFileFormatLabel")}</legend>
            <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
              {(Object.entries(formatLabels) as [Format, { label: string; desc: string }][]).map(([f, meta]) => {
                const disabledReason = formatDisabledReason[f];
                const disabled = disabledReason !== null;
                return (
                  <label
                    key={f}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, cursor: disabled ? "not-allowed" : "pointer",
                      padding: "10px 14px", borderRadius: 8, opacity: disabled ? 0.6 : 1,
                      border: `2px solid ${format === f ? "var(--accent, #2563eb)" : "var(--line2)"}`,
                      background: format === f ? "var(--infobg)" : "transparent",
                    }}
                  >
                    <input
                      type="radio"
                      name="wiz-format"
                      value={f}
                      checked={format === f}
                      disabled={disabled}
                      onChange={() => setFormat(f)}
                      aria-label={meta.label}
                      style={{ accentColor: "var(--accent)" }}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{meta.label}</div>
                      <div style={{ fontSize: 12, color: "var(--ink2)" }}>{disabledReason ?? meta.desc}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div>
            <Button disabled={!runId} onClick={() => setStep(1)}>
              {t("nextPreviewBtn")}
            </Button>
          </div>
        </div>
      )}

      {/* Step 1 — Preview (GAP-PAYROLL-DISBURSEMENT-05: real figures only) */}
      {step === 1 && selectedRun && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ background: "var(--panel)", borderRadius: 10, padding: "18px 20px" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>{t("filePreviewTitle")}</h3>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {[
                  [t("previewPayPeriod"), selectedRun.payPeriod],
                  [t("previewFormat"), formatLabels[format].label],
                  [t("previewNetAmount"), formatMoney(selectedRun.netAmountMinor)],
                  [t("previewRecordCount"), String(selectedRun.employeeCount)],
                  [t("previewRunId"), selectedRun.id],
                ].map(([k, v]) => (
                  <tr key={k} style={{ borderBottom: "1px solid var(--line2)" }}>
                    <td style={{ padding: "8px 0", color: "var(--ink2)", width: "40%" }}>{k}</td>
                    <td style={{ padding: "8px 0", fontWeight: 600 }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ marginTop: 12, fontSize: 12, color: "var(--ink2)" }}>
              <strong>{t("previewLayoutLabel")}</strong> {formatLabels[format].layout}
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink2)" }}>{t("previewNotAvailable")}</p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="ghost" onClick={() => setStep(0)}>{t("backBtn")}</Button>
            <Button onClick={() => setStep(2)}>{t("nextDscBtn")}</Button>
          </div>
        </div>
      )}

      {/* Step 2 — DSC (GAP-PAYROLL-DISBURSEMENT-03: no false signing claim) */}
      {step === 2 && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ background: "var(--panel)", borderRadius: 10, padding: "20px" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>{t("dscTitle")}</h3>
            {dsc.kind === "configured" ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <span aria-hidden="true" style={{ fontSize: 20 }}>{dscExpired ? "⛔" : dscExpiringSoon ? "⚠️" : "✅"}</span>
                  <span style={{ fontWeight: 600, color: dscExpired ? "var(--bad, #c0392b)" : dscExpiringSoon ? "var(--warn, #b45309)" : "var(--good, #27ae60)" }}>
                    {dscExpired ? t("dscExpired") : dscExpiringSoon ? t("dscExpiringSoon", { days: dscDaysLeft ?? 0 }) : t("dscOnFile")}
                  </span>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <tbody>
                    {[
                      [t("dscSubjectCn"), dsc.subjectCn],
                      [t("dscValidUntil"), formatIndianDate(dsc.notAfter)],
                      [t("dscSha256"), dsc.sha256Fingerprint.slice(0, 24) + "…"],
                    ].map(([k, v]) => (
                      <tr key={k} style={{ borderBottom: "1px solid var(--line2)" }}>
                        <td style={{ padding: "7px 0", color: "var(--ink2)", width: "40%" }}>{k}</td>
                        <td style={{ padding: "7px 0", fontWeight: 600, wordBreak: "break-all" }}>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <div style={{ display: "flex", gap: 10, color: "var(--warn, #b45309)" }}>
                <span aria-hidden="true" style={{ fontSize: 20 }}>⚠️</span>
                <div>
                  <p style={{ margin: 0, fontWeight: 600 }}>
                    {dsc.kind === "none" ? t("dscNotConfiguredTitle") : dsc.kind === "restricted" ? t("dscRestrictedTitle") : t("dscUnavailableTitle")}
                  </p>
                  {dsc.kind === "none" && (
                    <p style={{ margin: 0, fontSize: 12, color: "var(--ink2)" }}>
                      <a href="#dsc-config">{t("dscConfigureLink")}</a>
                    </p>
                  )}
                </div>
              </div>
            )}
            <p role="note" style={{ margin: "12px 0 0", fontSize: 12, color: "var(--ink2)" }}>
              {t("dscNotAppliedNote")}
            </p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="ghost" onClick={() => setStep(1)}>{t("backBtn")}</Button>
            <Button onClick={() => setStep(3)}>{t("nextDownloadBtn")}</Button>
          </div>
        </div>
      )}

      {/* Step 3 — Download / upload to bank */}
      {step === 3 && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ background: "var(--panel)", borderRadius: 10, padding: "28px", textAlign: "center" }}>
            {filename ? (
              <>
                <p aria-hidden="true" style={{ fontSize: 36, margin: "0 0 10px" }}>✅</p>
                <p style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{t("downloadedTitle")}</p>
                <p style={{ fontSize: 13, fontFamily: "monospace", color: "var(--ink2)" }}>{filename}</p>
                <p style={{ marginTop: 8 }}><SigningBadge format={sigFormat} signed={signed === true} /></p>
                {signed !== true && (
                  <p role="note" style={{ fontSize: 12, color: "var(--bad, #c0392b)", margin: "6px 0 0" }}>{t("unsignedDisclosure")}</p>
                )}
                {encrypted && <p style={{ fontSize: 12, color: "var(--ink2)", margin: "6px 0 0" }}>{t("encryptedNote")}</p>}
                {signed === true && issuanceId && (sigFormat === "pgp_detached" || sigFormat === "pkcs7_detached") && (
                  <div style={{ marginTop: 10 }}>
                    <Button variant="secondary" onClick={() => void downloadSignatureFor(issuanceId, filename)}>
                      {t("downloadSignatureBtn")}
                    </Button>
                    {sigError && (
                      <p role="alert" className="pill bad" style={{ marginTop: 8, width: "fit-content", marginInline: "auto" }}>{t("signatureDownloadFailed")}</p>
                    )}
                  </div>
                )}
                <p style={{ fontSize: 13, color: "var(--ink2)", marginTop: 10 }}>
                  {t("downloadedHint")}
                </p>
              </>
            ) : (
              <>
                <p aria-hidden="true" style={{ fontSize: 36, margin: "0 0 10px" }}>⬇️</p>
                <p style={{ fontWeight: 700, fontSize: 16, marginBottom: 12 }}>{t("readyTitle")}</p>
                {error && !confirmOpen && (
                  <p role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 13, marginBottom: 10 }}>{error}</p>
                )}
                <Button onClick={() => { setError(undefined); setConfirmOpen(true); }} disabled={busy || !selectedRun}>
                  {t("downloadBtn")}
                </Button>
              </>
            )}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {!filename && <Button variant="ghost" onClick={() => setStep(2)}>{t("backBtn")}</Button>}
            {filename && (
              <Button variant="ghost" onClick={() => { setStep(0); setFilename(null); setSigned(null); setSigFormat(null); setIssuanceId(null); setEncrypted(false); setSigError(false); setError(undefined); }}>
                {t("generateAnotherBtn")}
              </Button>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen && !!selectedRun}
        title={selectedRun?.status === "paid" ? t("confirmReissueTitle") : t("confirmTitle")}
        confirmLabel={busy ? t("generatingBtn") : t("confirmLabel")}
        danger={selectedRun?.status === "paid"}
        busy={busy}
        errorMessage={confirmOpen ? error : undefined}
        requireReason
        minReasonLength={10}
        maxReasonLength={500}
        reasonLabel={t("confirmReasonLabel")}
        description={
          selectedRun ? (
            <>
              {t("confirmDescription", {
                period: selectedRun.payPeriod,
                format: formatLabels[format].label,
                amount: formatMoney(selectedRun.netAmountMinor),
                count: selectedRun.employeeCount,
              })}
              {selectedRun.status === "paid" ? " " + t("confirmReissueWarning") : null}
              {" " + t("confirmUnsignedNote")}
            </>
          ) : null
        }
        onConfirm={(reason) => void downloadFile(reason ?? "")}
        onCancel={() => { if (!busy) { setConfirmOpen(false); setError(undefined); } }}
      />
    </div>
  );
}
