"use client";

/**
 * DocumentsPanel — client wrapper wiring DocumentUploadCard's callbacks to
 * the real backend (GAP-HR-ONBOARDING-DETAIL-02).
 *
 * Previously DocumentUploadCard presigned+PUT the file, set purely local
 * state, and called onUploaded -- which [id]/page.tsx (a server component)
 * never wired to anything. mark-received and verify/reject routes have
 * always existed but were never called: after a refresh the document went
 * back to "pending" and HR had no way to verify or reject a submission.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DocumentUploadCard, type OnboardingDocument } from "./DocumentUploadCard";
import { useFormError } from "@/lib/useFormError";

interface DocumentsPanelProps {
  employeeId: string;
  documents: OnboardingDocument[];
  /** i18n-sourced DPDP notice text (onboardingDetail.dpdpNoticeText), resolved server-side by the caller. */
  dpdpNotice?: string;
}

export function DocumentsPanel({ employeeId, documents, dpdpNotice }: DocumentsPanelProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const formError = useFormError("onboarding document");

  async function patchDoc(docType: string, path: "mark-received" | "verify", body: Record<string, unknown>) {
    setError(null);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/employees/${employeeId}/onboarding-documents/${docType}/${path}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      // Async write (F3 queue, same as every other mutation in this
      // module) -- refresh shortly after so the real committed status
      // (not just the presigned-upload's own local state) shows up.
      setTimeout(() => router.refresh(), 1000);
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    }
  }

  return (
    <div>
      <DocumentUploadCard
        documents={documents}
        dpdpNotice={dpdpNotice}
        onUploaded={(docId, fileName, key) => void patchDoc(docId, "mark-received", { storageKey: key, fileName })}
        onVerify={(docId) => void patchDoc(docId, "verify", { status: "verified" })}
        onReject={(docId) => void patchDoc(docId, "verify", { status: "rejected" })}
      />
      {error && (
        <p role="alert" style={{ margin: "10px 0 0", fontSize: 12, color: "var(--bad, #dc2626)", fontWeight: 500 }}>
          {error}
        </p>
      )}
    </div>
  );
}
