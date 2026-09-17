"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog } from "../../../../_components/ds";
import { browserFetch } from "@/lib/api/browserClient";
import { useFormError } from "@/lib/useFormError";

type RunOption = { id: string; payPeriod: string; netAmount: number };

type Format = "csv" | "nach" | "apbs";

// UX-017: this component is not currently imported anywhere (page.tsx uses
// BankFileWizard instead, a later multi-step version of the same flow) --
// confirmed via a fleet-wide grep for "BankFileForm", the only other match
// is this file's own test. Left in place (deleting dead code is a separate,
// out-of-scope decision) but still translated: it is still reachable by its
// own test and by any future re-wiring, and leaving hardcoded English text
// in it would not serve this gap's "0 findings" goal for the disbursement/
// slice. Disclosed as a scope surprise in this tranche's PR description.
export function BankFileForm({ runs }: { runs: RunOption[] }) {
  const t = useTranslations("bankFileForm");
  const [runId, setRunId] = useState(runs[0]?.id ?? "");
  const [format, setFormat] = useState<Format>("csv");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [runInvalid, setRunInvalid] = useState(false);
  const formError = useFormError("bank file");

  const runSelectId = useId();
  const formatSelectId = useId();
  const errId = useId();
  const runSelectRef = useRef<HTMLSelectElement>(null);

  const selectedRun = runs.find((r) => r.id === runId);

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setMessage(null);
    setRunInvalid(false);
    if (!runId) {
      setError(t("selectRunError"));
      setRunInvalid(true);
      runSelectRef.current?.focus();
      return;
    }
    setConfirmOpen(true);
  }

  async function generate() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await browserFetch(`v1/payroll/runs/${runId}/bank-file?format=${format}`, {
        method: "GET",
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setError(resolved.message);
        return;
      }
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = /filename="?([^";]+)"?/.exec(disposition);
      const filename = match?.[1] ?? `bank_transfer_${runId}.${format === "csv" ? "csv" : "txt"}`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setConfirmOpen(false);
      setMessage(t("generatedMessage", { filename }));
    } catch {
      setError(formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={openConfirm}>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
        <div style={{ display: "grid", gap: 6 }}>
          <label htmlFor={runSelectId} style={{ fontSize: 13, fontWeight: 600 }}>
            {t("payrollRunLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
          </label>
          <select
            id={runSelectId}
            ref={runSelectRef}
            value={runId}
            onChange={(e) => {
              setRunId(e.target.value);
              setRunInvalid(false);
            }}
            aria-required="true"
            aria-invalid={runInvalid || undefined}
            aria-describedby={runInvalid ? errId : undefined}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
          >
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.payPeriod}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <label htmlFor={formatSelectId} style={{ fontSize: 13, fontWeight: 600 }}>
            {t("fileFormatLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
          </label>
          <select
            id={formatSelectId}
            value={format}
            onChange={(e) => setFormat(e.target.value as Format)}
            aria-required="true"
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
          >
            <option value="csv">{t("formatCsvOption")}</option>
            <option value="nach">{t("formatNachOption")}</option>
            <option value="apbs">{t("formatApbsOption")}</option>
          </select>
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <Button type="submit" style={{ minHeight: 44 }} disabled={busy || runs.length === 0}>
          {t("generateDownloadBtn")}
        </Button>
      </div>
      {error && !confirmOpen && (
        <p id={errId} role="alert" className="pill bad" style={{ marginTop: 10, width: "fit-content" }}>
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="pill good" style={{ marginTop: 10, width: "fit-content" }}>
          {message}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        danger
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={error}
        description={t.rich("confirmDescription", {
          format: format.toUpperCase(),
          period: selectedRun?.payPeriod ?? t("confirmDescriptionFallbackRun"),
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        onConfirm={() => void generate()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
