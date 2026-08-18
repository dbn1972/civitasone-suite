"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, useToast } from "@/app/_components/ds";

interface ApprovalFinalizeButtonProps {
  id: string;
  type: "aa" | "ts";
  status: string;
}

const LABELS = {
  aa: { title: "Finalize Administrative Approval", label: "Finalize AA" },
  ts: { title: "Finalize Technical Sanction", label: "Finalize TS" },
} as const;

export function ApprovalFinalizeButton({ id, type, status }: ApprovalFinalizeButtonProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  if (status !== "draft") return null;

  async function handleFinalize() {
    setBusy(true);
    setErrorMessage("");
    try {
      const res = await fetch(
        `/api/proxy/v1/works/approvals/${type}/${id}/finalize`,
        { method: "POST" },
      );
      if (!res.ok) {
        setErrorMessage(await res.text().catch(() => "Request failed"));
        return;
      }
      toast.success(`${type.toUpperCase()} finalized successfully.`);
      setOpen(false);
      setTimeout(() => router.refresh(), 600);
    } catch {
      setErrorMessage("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const { title, label } = LABELS[type];

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn primary">
        {label}
      </button>
      <ConfirmDialog
        open={open}
        title={title}
        description="Once finalized this approval cannot be revised. Ensure all details are correct before proceeding."
        confirmLabel="Finalize"
        danger
        busy={busy}
        errorMessage={errorMessage || undefined}
        onConfirm={handleFinalize}
        onCancel={() => {
          setOpen(false);
          setErrorMessage("");
        }}
      />
    </>
  );
}
