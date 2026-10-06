"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { useFormError } from "@/lib/useFormError";

interface DisburseButtonProps {
  /** The schemeId — maps to projectId on FundReleaseSummary (backend stores schemeId as projectId). */
  schemeId: string;
  releaseId: string;
  releaseNo: string;
  /** GAP-PROJECTS-FUND-RELEASES-01: amount (paise) shown in the confirm recap. */
  amount: number;
  /** GAP-PROJECTS-FUND-RELEASES-01: project name shown in the confirm recap. */
  projectName: string;
}

// GAP-PROJECTS-FUND-RELEASES-02: a conservative PFMS reference format. The exact
// authority format is unconfirmed (project-service's disburseBody only has
// `pfmsRef: z.string().optional()` with no pattern), so this is a defensive
// client gate — alphanumeric with - / _, 6..40 chars — not a claim of the real
// spec. Flagged for HUMAN REVIEW to confirm the true format before relying on it.
const PFMS_REF_RE = /^[A-Za-z0-9][A-Za-z0-9/_-]{5,39}$/;

export function DisburseButton({ schemeId, releaseId, releaseNo, amount, projectName }: DisburseButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [success, setSuccess] = useState<string | null>(null);
  const [pfmsRef, setPfmsRef] = useState("");
  const pfmsFieldId = useId();
  const formError = useFormError("fund release");

  const pfmsValid = PFMS_REF_RE.test(pfmsRef.trim());

  async function handleConfirm(reason?: string) {
    setBusy(true);
    setErrorMessage(undefined);
    try {
      const res = await fetch(
        `/api/proxy/v1/projects/schemes/${schemeId}/fund-releases/${releaseId}/disburse`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          // GAP-PROJECTS-FUND-RELEASES-02: send pfmsRef and the audit reason as
          // SEPARATE fields (they are no longer the same string). The server
          // persists `reason` on the disburse audit event (disburseBody).
          body: JSON.stringify({ pfmsRef: pfmsRef.trim(), ...(reason ? { reason } : {}) }),
        },
      );
      if (!res.ok) {
        setErrorMessage((await formError.fromResponse(res, "save")).message);
        setBusy(false);
        return;
      }
      setBusy(false);
      setOpen(false);
      setSuccess(`Fund release ${releaseNo} disbursed.`);
      router.refresh();
    } catch (caught) {
      setErrorMessage(formError.fromException("save", caught).message);
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="primary"
        style={{ minHeight: 36, fontSize: "0.8125rem" }}
        onClick={(e) => {
          // The row is a clickable link to the project; don't navigate when the
          // user is reaching for the Disburse control.
          e.stopPropagation();
          setErrorMessage(undefined);
          setPfmsRef("");
          setOpen(true);
        }}
      >
        Disburse
      </Button>

      {success && (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#067647", margin: "4px 0 0" }}>
          {success}
        </p>
      )}

      <ConfirmDialog
        open={open}
        title={`Disburse fund release ${releaseNo}`}
        description={
          <>
            This will mark release <strong>{releaseNo}</strong> for{" "}
            <strong>{projectName}</strong> as disbursed. Amount:{" "}
            <strong>{formatMoney(amount)}</strong>. This cannot be undone.
          </>
        }
        confirmLabel="Disburse"
        requireReason
        reasonLabel="Reason (recorded in the audit trail)"
        blockConfirm={!pfmsValid}
        busy={busy}
        errorMessage={errorMessage}
        onConfirm={(reason) => void handleConfirm(reason)}
        onCancel={() => {
          if (!busy) setOpen(false);
        }}
      >
        {/* GAP-PROJECTS-FUND-RELEASES-02: dedicated, validated PFMS reference,
            separate from the free-text audit reason below. */}
        <div className="cd-field">
          <label htmlFor={pfmsFieldId}>PFMS reference</label>
          <input
            id={pfmsFieldId}
            type="text"
            value={pfmsRef}
            onChange={(e) => setPfmsRef(e.target.value)}
            aria-invalid={pfmsRef.length > 0 && !pfmsValid}
            placeholder="e.g. PFMS-2026-000123"
          />
          {pfmsRef.length > 0 && !pfmsValid && (
            <p style={{ fontSize: 12, color: "#b42318", margin: "4px 0 0" }}>
              Enter a valid PFMS reference (6–40 letters/digits, - / _).
            </p>
          )}
        </div>
      </ConfirmDialog>
    </>
  );
}
