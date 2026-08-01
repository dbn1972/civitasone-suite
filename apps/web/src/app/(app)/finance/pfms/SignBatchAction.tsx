"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, useConfirmAction } from "../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

interface SignBatchActionProps {
  batchId: string;
  pfmsId: string;
}

/** POST /v1/finance/pfms/:id/sign — applies a DSC signature to a PFMS batch. Irreversible. */
export function SignBatchAction({ batchId, pfmsId }: SignBatchActionProps) {
  const router = useRouter();
  const [certificateRef, setCertificateRef] = useState("");
  const [signaturePayload, setSignaturePayload] = useState("");
  const certId = useId();
  const payloadId = useId();

  const { open, busy, error, trigger, cancel, confirm } = useConfirmAction({
    onConfirm: async () => {
      if (!certificateRef.trim() || !signaturePayload.trim()) {
        throw new Error("Certificate reference and signature payload are both required.");
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
      router.refresh();
    },
  });

  return (
    <>
      <button
        type="button"
        className="btn primary"
        aria-label={`Sign PFMS batch ${pfmsId}`}
        onClick={trigger}
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
                value={certificateRef}
                onChange={(e) => setCertificateRef(e.target.value)}
                maxLength={256}
                aria-required="true"
                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={payloadId} style={{ fontSize: 13, fontWeight: 600 }}>
                Signature payload <span aria-hidden="true">*</span>
              </label>
              <textarea
                id={payloadId}
                rows={3}
                value={signaturePayload}
                onChange={(e) => setSignaturePayload(e.target.value)}
                maxLength={8192}
                aria-required="true"
                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)" }}
              />
            </div>
          </div>
        }
        onConfirm={() => void confirm()}
        onCancel={cancel}
      />
    </>
  );
}
