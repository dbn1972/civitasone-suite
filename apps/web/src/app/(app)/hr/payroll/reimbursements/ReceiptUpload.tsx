"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";
import { RECEIPT_ACCEPT, RECEIPT_MAX_FILES, receiptProblem } from "@/lib/payroll/receiptRules";

export type Receipt = { key: string; name: string };

/**
 * GAP-PAYROLL-REIMBURSEMENTS-03: attach receipts to a claim. For each file:
 * ask payroll-service for a short-lived presigned PUT URL (it picks the
 * tenant-scoped private object key), then upload the file straight to the
 * object store -- the file never passes through the API. Only the returned
 * keys are submitted with the claim. Receipts can hold health information, so
 * they are private: viewing one goes through an audited endpoint.
 */
export function ReceiptUpload({
  receipts, onChange, onBusyChange,
}: {
  receipts: Receipt[];
  onChange: (next: Receipt[]) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const t = useTranslations("receiptUpload");
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    onBusyChange?.(true);
    let current = receipts;
    try {
      for (const file of Array.from(files)) {
        const problem = receiptProblem(file, current.length);
        if (problem) {
          setError(t(problem === "type" ? "typeError" : problem === "size" ? "sizeError" : "limitError", { name: file.name, max: RECEIPT_MAX_FILES }));
          break;
        }
        const presign = await browserFetch("v1/payroll/reimbursements/attachments/presign", {
          method: "POST",
          body: JSON.stringify({ filename: file.name, contentType: file.type, sizeBytes: file.size }),
        });
        if (!presign.ok) {
          setError(presign.status === 503 ? t("storageUnavailableError") : await errorMessageFromResponse(presign));
          break;
        }
        const { storageKey, uploadUrl } = (await presign.json()) as { storageKey: string; uploadUrl: string };
        const put = await fetch(uploadUrl, { method: "PUT", headers: { "content-type": file.type }, body: file });
        if (!put.ok) {
          setError(t("uploadFailedError", { name: file.name }));
          break;
        }
        current = [...current, { key: storageKey, name: file.name }];
        onChange(current);
      }
    } catch {
      setError(t("uploadFailedGeneric"));
    } finally {
      setUploading(false);
      onBusyChange?.(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <label htmlFor={inputId} style={{ fontSize: 13, fontWeight: 600 }}>{t("label")}</label>
      <input
        id={inputId}
        ref={fileRef}
        type="file"
        multiple
        accept={RECEIPT_ACCEPT}
        disabled={uploading || receipts.length >= RECEIPT_MAX_FILES}
        onChange={(e) => void handleFiles(e.target.files)}
        style={{ minHeight: 44 }}
      />
      <p style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>{t("hint", { max: RECEIPT_MAX_FILES })}</p>
      {uploading && <p role="status" style={{ margin: 0, fontSize: 13 }}>{t("uploading")}</p>}
      {error && <p role="alert" className="pill bad" style={{ margin: 0, width: "fit-content" }}>{error}</p>}
      {receipts.length > 0 && (
        <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 13 }}>
          {receipts.map((r) => (
            <li key={r.key}>
              {r.name}{" "}
              <button
                type="button"
                className="btn ghost sm"
                aria-label={t("removeAria", { name: r.name })}
                onClick={() => onChange(receipts.filter((x) => x.key !== r.key))}
              >
                {t("remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
