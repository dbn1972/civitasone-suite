"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, Field, Input, Select, Textarea } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type RunOption = { id: string; payPeriod: string };
type ReturnSummary = { credited: number; returned: number; unmatched: number };

export function NachReturnForm({ runs }: { runs: RunOption[] }) {
  const t = useTranslations("nachReturnForm");
  const tv = useTranslations("hrFormErrors2");
  const [runId, setRunId] = useState(runs[0]?.id ?? "");
  const [content, setContent] = useState("");
  // Which issued NACH file this return answers; the API asks for it only when
  // the run has more than one NACH file (422 FILE_REFERENCE_REQUIRED).
  const [fileReference, setFileReference] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<ReturnSummary | null>(null);
  const [runInvalid, setRunInvalid] = useState(false);
  const [contentInvalid, setContentInvalid] = useState(false);

  const runSelectId = useId();
  const contentId = useId();
  const fileRefId = useId();
  const fileRefHintId = useId();
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
        body: JSON.stringify(fileReference.trim() ? { content, fileReference: fileReference.trim() } : { content }),
      });
      setConfirmOpen(false);
      setResult(res.data);
      setContent("");
      setFileReference("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={openConfirm}>
      <div style={{ display: "grid", gap: 14 }}>
        <Field id={runSelectId} label={t("payrollRunLabel")} required error={runInvalid ? tv("fieldRequired") : undefined} style={{ display: "grid", gap: 6, maxWidth: 320 }}>
          <Select
            ref={runSelectRef}
            value={runId}
            onChange={(e) => {
              setRunId(e.target.value);
              setRunInvalid(false);
            }}
          >
            {runs.map((r) => (
              <option key={r.id} value={r.id}>{r.payPeriod}</option>
            ))}
          </Select>
        </Field>
        <Field id={contentId} label={t("returnFileContentLabel")} required error={contentInvalid ? tv("fieldRequired") : undefined}>
          <Textarea
            ref={contentRef}
            rows={8}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setContentInvalid(false);
            }}
            placeholder={t("returnFileContentPlaceholder")}
          />
        </Field>
        <Field id={fileRefId} label={t("fileReferenceLabel")} style={{ maxWidth: 420 }}>
          <Input
            type="text"
            value={fileReference}
            onChange={(e) => setFileReference(e.target.value)}
            aria-describedby={fileRefHintId}
            maxLength={200}
            style={{ fontFamily: "monospace", fontSize: 12 }}
          />
          <p id={fileRefHintId} style={{ margin: 0, fontSize: 12, color: "var(--ink2)" }}>{t("fileReferenceHint")}</p>
        </Field>
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
