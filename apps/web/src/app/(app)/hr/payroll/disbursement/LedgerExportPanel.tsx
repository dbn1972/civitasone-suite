"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, Field, Select, Textarea } from "../../../../_components/ds";
import { browserFetch, browserJson } from "@/lib/api/browserClient";

/**
 * M9: payroll without Finance. Shown only for a tenant in export-only ledger
 * mode (no Finance module, or an explicit override): the salary journals to
 * download, the bank's confirmation file that marks slips paid, and the mode
 * itself. A tenant on the Finance path never sees this panel.
 */
export type LedgerRun = { id: string; payPeriod: string; status: string };
export type LedgerModeInfo = { mode: "export" | "finance"; source: "override" | "derived"; override: "export" | "finance" | null };

type Override = "" | "finance" | "export";

export function LedgerExportPanel({ runs, mode, canConfirm }: { runs: LedgerRun[]; mode: LedgerModeInfo; canConfirm: boolean }) {
  const t = useTranslations("ledgerExportPanel");
  const exportable = runs.filter((r) => r.status === "completed" || r.status === "paid");
  const disbursed = runs.filter((r) => r.status === "paid");

  const [journalRun, setJournalRun] = useState(exportable[0]?.id ?? "");
  const [journalBusy, setJournalBusy] = useState(false);
  const [journalError, setJournalError] = useState<string | undefined>();

  const [confirmRun, setConfirmRun] = useState(disbursed[0]?.id ?? "");
  const [content, setContent] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<{ rows: number; success: number; failed: number } | null>(null);
  const [contentInvalid, setContentInvalid] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const [override, setOverride] = useState<Override>(mode.override ?? "");
  const [overrideBusy, setOverrideBusy] = useState(false);
  const [overrideMsg, setOverrideMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const journalRunId = useId();
  const confirmRunId = useId();
  const contentId = useId();
  const fileId = useId();
  const overrideId = useId();

  async function download(format: "csv" | "tally") {
    if (!journalRun) return;
    setJournalBusy(true);
    setJournalError(undefined);
    try {
      const res = await browserFetch(`v1/payroll/runs/${encodeURIComponent(journalRun)}/journal-export?format=${format}`);
      if (!res.ok) {
        setJournalError(t("downloadError"));
        return;
      }
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = /filename="?([^";]+)"?/.exec(disposition);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = match?.[1] ?? `payroll-journal.${format === "csv" ? "csv" : "xml"}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setJournalError(t("networkError"));
    } finally {
      setJournalBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setContent(await file.text());
    setContentInvalid(false);
  }

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setResult(null);
    const missing = !content.trim();
    setContentInvalid(missing);
    if (!confirmRun || missing) {
      setError(t("requiredError"));
      if (missing) contentRef.current?.focus();
      return;
    }
    setConfirmOpen(true);
  }

  async function submitConfirmation() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await browserJson<{ data: { rows: number; success: number; failed: number } }>(`v1/payroll/runs/${encodeURIComponent(confirmRun)}/bank-confirmation`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      setConfirmOpen(false);
      setResult(res.data);
      setContent("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  async function saveOverride() {
    setOverrideBusy(true);
    setOverrideMsg(null);
    try {
      // The settings update replaces the protected-net floor, so send back the stored one with the new override.
      const current = await browserJson<{ protectedNetFloorMinor?: number }>("v1/payroll/settings");
      await browserJson("v1/payroll/settings", {
        method: "PUT",
        body: JSON.stringify({ protectedNetFloorMinor: current.protectedNetFloorMinor ?? 0, ledgerModeOverride: override === "" ? null : override }),
      });
      setOverrideMsg({ ok: true, text: t("overrideSaved") });
    } catch (err) {
      // The server says why (for example: forcing export-only mode on a tenant that has Finance needs a super admin).
      setOverrideMsg({ ok: false, text: err instanceof Error && err.message ? err.message : t("overrideError") });
    } finally {
      setOverrideBusy(false);
    }
  }

  return (
    <div className="pad" style={{ display: "grid", gap: 22 }}>
      <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)" }}>
        {mode.source === "override" ? t("modeOverride") : t("modeDerived")}
      </p>

      <section aria-labelledby={`${journalRunId}-h`} style={{ display: "grid", gap: 10 }}>
        <h3 id={`${journalRunId}-h`} style={{ margin: 0, fontSize: 15 }}>{t("journalHeading")}</h3>
        <p style={{ margin: 0, fontSize: 12, color: "var(--ink2)" }}>{t("journalHelp")}</p>
        {exportable.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13 }}>{t("noJournalRuns")}</p>
        ) : (
          <>
            <Field id={journalRunId} label={t("runLabel")} style={{ display: "grid", gap: 6, maxWidth: 320 }}>
              <Select value={journalRun} onChange={(e) => setJournalRun(e.target.value)}>
                {exportable.map((r) => (<option key={r.id} value={r.id}>{r.payPeriod}</option>))}
              </Select>
            </Field>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Button type="button" style={{ minHeight: 44 }} disabled={journalBusy} onClick={() => void download("csv")}>{t("downloadCsv")}</Button>
              <Button type="button" variant="secondary" style={{ minHeight: 44 }} disabled={journalBusy} onClick={() => void download("tally")}>{t("downloadTally")}</Button>
            </div>
            {journalError && <p role="alert" className="pill bad" style={{ margin: 0, width: "fit-content" }}>{journalError}</p>}
          </>
        )}
      </section>

      <section style={{ display: "grid", gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{t("confirmHeading")}</h3>
        <p style={{ margin: 0, fontSize: 12, color: "var(--ink2)" }}>{t("confirmHelp")}</p>
        {!canConfirm ? (
          <p style={{ margin: 0, fontSize: 13 }}>{t("adminOnly")}</p>
        ) : disbursed.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13 }}>{t("noDisbursedRuns")}</p>
        ) : (
          <form noValidate onSubmit={openConfirm} style={{ display: "grid", gap: 12 }}>
            <Field id={confirmRunId} label={t("confirmRunLabel")} style={{ display: "grid", gap: 6, maxWidth: 320 }}>
              <Select value={confirmRun} onChange={(e) => setConfirmRun(e.target.value)}>
                {disbursed.map((r) => (<option key={r.id} value={r.id}>{r.payPeriod}</option>))}
              </Select>
            </Field>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={fileId} style={{ fontSize: 13 }}>{t("fileLabel")}</label>
              <input id={fileId} type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(e) => void onFile(e)} />
            </div>
            <Field id={contentId} label={t("contentLabel")} required error={contentInvalid ? t("requiredError") : undefined}>
              <Textarea
                ref={contentRef}
                rows={7}
                value={content}
                onChange={(e) => { setContent(e.target.value); setContentInvalid(false); }}
                placeholder={t("contentPlaceholder")}
                style={{ fontFamily: "monospace", fontSize: 12 }}
              />
            </Field>
            <div><Button type="submit" style={{ minHeight: 44 }} disabled={busy}>{t("submitBtn")}</Button></div>
            {error && !confirmOpen && <p role="alert" className="pill bad" style={{ margin: 0, width: "fit-content" }}>{error}</p>}
            {result && (
              <p role="status" className="pill good" style={{ margin: 0, width: "fit-content" }}>
                {t("queuedMessage", { rows: result.rows, success: result.success, failed: result.failed })}
              </p>
            )}
            <ConfirmDialog
              open={confirmOpen}
              title={t("confirmTitle")}
              danger
              confirmLabel={t("confirmLabel")}
              busy={busy}
              errorMessage={error}
              description={t("confirmDescription")}
              onConfirm={() => void submitConfirmation()}
              onCancel={() => !busy && setConfirmOpen(false)}
            />
          </form>
        )}
      </section>

      {canConfirm && (
        <section style={{ display: "grid", gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>{t("overrideHeading")}</h3>
          <Field id={overrideId} label={t("overrideLabel")} style={{ display: "grid", gap: 6, maxWidth: 320 }}>
            <Select value={override} onChange={(e) => setOverride(e.target.value as Override)}>
              <option value="">{t("overrideDerived")}</option>
              <option value="finance">{t("overrideFinance")}</option>
              <option value="export">{t("overrideExport")}</option>
            </Select>
          </Field>
          <div><Button type="button" variant="secondary" style={{ minHeight: 44 }} disabled={overrideBusy} onClick={() => void saveOverride()}>{t("overrideSave")}</Button></div>
          {overrideMsg && (
            <p role={overrideMsg.ok ? "status" : "alert"} className={`pill ${overrideMsg.ok ? "good" : "bad"}`} style={{ margin: 0, width: "fit-content" }}>{overrideMsg.text}</p>
          )}
        </section>
      )}
    </div>
  );
}
