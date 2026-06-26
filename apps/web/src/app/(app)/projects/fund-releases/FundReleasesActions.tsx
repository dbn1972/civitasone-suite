"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/app/_components/ds";

interface DisburseButtonProps {
  /** The schemeId — maps to projectId on FundReleaseSummary (backend stores schemeId as projectId). */
  schemeId: string;
  releaseId: string;
  releaseNo: string;
}

export function DisburseButton({ schemeId, releaseId, releaseNo }: DisburseButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  async function handleConfirm(reason?: string) {
    setBusy(true);
    setErrorMessage(undefined);
    try {
      const res = await fetch(
        `/api/proxy/v1/projects/schemes/${schemeId}/fund-releases/${releaseId}/disburse`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(reason ? { pfmsRef: reason } : {}),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        setErrorMessage(text || `Request failed (${res.status})`);
        setBusy(false);
        return;
      }
      setBusy(false);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Network error");
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn primary"
        style={{ minHeight: 36, fontSize: "0.8125rem" }}
        onClick={() => {
          setErrorMessage(undefined);
          setOpen(true);
        }}
      >
        Disburse
      </button>

      <ConfirmDialog
        open={open}
        title={`Disburse fund release ${releaseNo}`}
        description="This will mark the release as disbursed. Enter the PFMS reference or reason to proceed."
        confirmLabel="Disburse"
        requireReason
        reasonLabel="PFMS reference / reason"
        busy={busy}
        errorMessage={errorMessage}
        onConfirm={(reason) => void handleConfirm(reason)}
        onCancel={() => {
          if (!busy) setOpen(false);
        }}
      />
    </>
  );
}
