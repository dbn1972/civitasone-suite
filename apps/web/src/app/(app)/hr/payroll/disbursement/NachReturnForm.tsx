"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type RunOption = { id: string; payPeriod: string };
type ReturnSummary = { credited: number; returned: number; unmatched: number };

export function NachReturnForm({ runs }: { runs: RunOption[] }) {
  const t = useTranslations("nachReturnForm");
  const [runId, setRunId] = useState(runs[0]?.id ?? "");
  const [content, setContent] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<ReturnSummary | null>(null);
  const [runInvalid, setRunInvalid] = useState(false);
  const [contentInvalid, setContentInvalid] = useState(false);

  const runSelectId = useId();
  const contentId = useId();
  const errId = useId();
  const runSelectRef = useRef<HTMLSelectElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setResult(null);
    const runMissing = !runId;
    const contentMissing = !content.trim();
    setRunInvalid(runMissing);
    setContentInvalid(contentMissing);
    if (runMissing || contentMissing) {
      setError(t("requiredFieldsError"));
      if (runMissing) {
        runSelectRef.current?.focus();
      } else {
        contentRef.current?.focus();
      }
      return;
    }
    setConfirmOpen(true);
  }

  async function processReturn() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await browserJson<{ data: ReturnSummary }>(`v1/payroll/runs/${runId}/nach-return`, {
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

  return (
    <form onSubmit={openConfirm}>
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gap: 6, maxWidth: 320 }}>
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
              <option key={r.id} value={r.id}>{r.payPeriod}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <label htmlFor={contentId} style={{ fontSize: 13, fontWeight: 600 }}>
            {t("returnFileContentLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
          </label>
          <textarea
            id={contentId}
            ref={contentRef}
            rows={8}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setContentInvalid(false);
            }}
            aria-required="true"
            aria-invalid={contentInvalid || undefined}
            aria-describedby={contentInvalid ? errId : undefined}
            placeholder={t("returnFileContentPlaceholder")}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", fontFamily: "monospace", fontSize: 12 }}
          />
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <Button type="submit" style={{ minHeight: 44 }} disabled={busy || runs.length === 0}>
          {t("processBtn")}
        </Button>
      </div>
      {error && !confirmOpen && (
        <p id={errId} role="alert" className="pill bad" style={{ marginTop: 10, width: "fit-content" }}>
          {error}
        </p>
      )}
      {result && (
        <p role="status" className="pill good" style={{ marginTop: 10, width: "fit-content" }}>
          {t("processedMessage", { credited: result.credited, returned: result.returned, unmatched: result.unmatched })}
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
        onConfirm={() => void processReturn()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
