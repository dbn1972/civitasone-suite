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
 *
 * The writes are async (202 -> queue consumer), so after each one this polls the
 * documents list (the resource's own existing GET) until the expected status is
 * visible, then refreshes the page -- the cards re-adopt the server status, so a
 * Verify/Reject shows in-session instead of after a full reload. If the change
 * never appears within the poll budget the notice says so honestly and offers a
 * manual refresh; nothing is faked.
 */

import { useState } from "react";
import { DocumentUploadCard, type OnboardingDocument } from "./DocumentUploadCard";
import { useFormError } from "@/lib/useFormError";
import { AcceptedNotice } from "@/app/_components/ds";
import { useAcceptedWrite } from "@/lib/useAcceptedWrite";

/** What a just-accepted write is expected to produce, so the poll knows when it has landed. */
interface ExpectedDocState {
  docType: string;
  status: "uploaded" | "verified" | "rejected";
}

type PolledDocument = { docType: string; status: string };

interface DocumentsPanelProps {
  employeeId: string;
  documents: OnboardingDocument[];
  /** i18n-sourced DPDP notice text (onboardingDetail.dpdpNoticeText), resolved server-side by the caller. */
  dpdpNotice?: string;
}

export function DocumentsPanel({ employeeId, documents, dpdpNotice }: DocumentsPanelProps) {
  const accepted = useAcceptedWrite<ExpectedDocState, PolledDocument[]>({
    poll: async () => {
      const res = await fetch(`/api/proxy/v1/hrms/employees/${employeeId}/onboarding-documents`, { cache: "no-store" });
      if (!res.ok) throw new Error("documents not readable yet");
      const body = (await res.json()) as { data?: PolledDocument[] } | PolledDocument[];
      return Array.isArray(body) ? body : (body.data ?? []);
    },
    isDone: (rows, expected) => rows.some((r) => r.docType === expected.docType && r.status === expected.status),
  });
  const [error, setError] = useState<string | null>(null);
  const formError = useFormError("onboarding document");

  async function patchDoc(
    docType: string,
    path: "mark-received" | "verify",
    body: Record<string, unknown>,
    expectedStatus: ExpectedDocState["status"],
  ) {
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
      // Async write (F3 queue, same as every other mutation in this module): poll the
      // documents list until the committed status is visible, then the page refreshes.
      void accepted.accept({ docType, status: expectedStatus });
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    }
  }

  return (
    <div>
      <AcceptedNotice {...accepted.noticeProps} />
      <DocumentUploadCard
        documents={documents}
        dpdpNotice={dpdpNotice}
        onUploaded={(docId, fileName, key) => void patchDoc(docId, "mark-received", { storageKey: key, fileName }, "uploaded")}
        onVerify={(docId) => void patchDoc(docId, "verify", { status: "verified" }, "verified")}
        onReject={(docId) => void patchDoc(docId, "verify", { status: "rejected" }, "rejected")}
      />
      {error && (
        <p role="alert" style={{ margin: "10px 0 0", fontSize: 12, color: "var(--bad)", fontWeight: 500 }}>
          {error}
        </p>
      )}
    </div>
  );
}
