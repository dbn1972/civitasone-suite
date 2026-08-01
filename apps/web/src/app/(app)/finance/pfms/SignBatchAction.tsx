"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, useConfirmAction } from "../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

interface SignBatchActionProps {
  batchId: string;
  pfmsId: string;
}

type SignFieldKey = "certificateRef" | "signaturePayload";

const FIELD_ERRORS: Record<SignFieldKey, string> = {
  certificateRef: "Certificate reference is required.",
  signaturePayload: "Signature payload is required.",
};

/** POST /v1/finance/pfms/:id/sign — applies a DSC signature to a PFMS batch. Irreversible. */
export function SignBatchAction({ batchId, pfmsId }: SignBatchActionProps) {
  const router = useRouter();
  const [certificateRef, setCertificateRef] = useState("");
  const [signaturePayload, setSignaturePayload] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SignFieldKey, string>>>({});
  const certId = useId();
  const payloadId = useId();
  const certRef = useRef<HTMLInputElement>(null);
  const payloadRef = useRef<HTMLTextAreaElement>(null);

  const { open, busy, error, trigger, cancel, confirm } = useConfirmAction({
    onConfirm: async () => {
      // Validate BEFORE calling the sign endpoint — never POST an incomplete
      // DSC signature. Set per-field errors + focus the first empty field
      // rather than a single generic message.
      const nextErrors: Partial<Record<SignFieldKey, string>> = {};
      if (!certificateRef.trim()) nextErrors.certificateRef = FIELD_ERRORS.certificateRef;
      if (!signaturePayload.trim()) nextErrors.signaturePayload = FIELD_ERRORS.signaturePayload;
      setFieldErrors(nextErrors);
      if (nextErrors.certificateRef) {
        certRef.current?.focus();
        throw new Error(nextErrors.certificateRef);
      }
      if (nextErrors.signaturePayload) {
        payloadRef.current?.focus();
        throw new Error(nextErrors.signaturePayload);
      }

      await browserJson(`v1/finance/pfms/${batchId}/sign`, {
        method: "POST",
        body: JSON.stringify({
          certificateRef: certificateRef.trim(),
          signaturePayload: signaturePayload.trim(),
        }),
      });
    },
    onSuccess: () => {
      setCertificateRef("");
      setSignaturePayload("");
      setFieldErrors({});
      router.refresh();
    },
  });

  return (
    <>
      <button
        type="button"
        className="btn primary"
        aria-label={`Sign PFMS batch ${pfmsId}`}
        onClick={() => {
          setFieldErrors({});
          trigger();
        }}
        style={{ minHeight: 36 }}
      >
        Sign
      </button>
      <ConfirmDialog
        open={open}
        title={`Sign PFMS batch ${pfmsId}?`}
        confirmLabel="Sign batch"
        danger
        busy={busy}
        errorMessage={error}
        description={
          <div style={{ display: "grid", gap: 12 }}>
            <p>
              This applies a digital signature to batch <strong>{pfmsId}</strong> and marks it
              signed. This action cannot be undone.
            </p>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={certId} style={{ fontSize: 13, fontWeight: 600 }}>
                Certificate reference <span aria-hidden="true">*</span>
              </label>
              <input
                id={certId}
                ref={certRef}
                value={certificateRef}
                onChange={(e) => setCertificateRef(e.target.value)}
                maxLength={256}
                aria-required="true"
                aria-invalid={!!fieldErrors.certificateRef || undefined}
                aria-describedby={fieldErrors.certificateRef ? `${certId}-error` : undefined}
                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40 }}
              />
              {fieldErrors.certificateRef && (
                <p id={`${certId}-error`} role="alert" className="pill bad" style={{ width: "fit-content" }}>
                  {fieldErrors.certificateRef}
                </p>
              )}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={payloadId} style={{ fontSize: 13, fontWeight: 600 }}>
                Signature payload <span aria-hidden="true">*</span>
              </label>
              <textarea
                id={payloadId}
                ref={payloadRef}
                rows={3}
                value={signaturePayload}
                onChange={(e) => setSignaturePayload(e.target.value)}
                maxLength={8192}
                aria-required="true"
                aria-invalid={!!fieldErrors.signaturePayload || undefined}
                aria-describedby={fieldErrors.signaturePayload ? `${payloadId}-error` : undefined}
                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)" }}
              />
              {fieldErrors.signaturePayload && (
                <p id={`${payloadId}-error`} role="alert" className="pill bad" style={{ width: "fit-content" }}>
                  {fieldErrors.signaturePayload}
                </p>
              )}
            </div>
          </div>
        }
        onConfirm={() => void confirm()}
        onCancel={cancel}
      />
    </>
  );
}
