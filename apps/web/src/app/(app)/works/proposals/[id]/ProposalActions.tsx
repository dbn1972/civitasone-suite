"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, useToast } from "@/app/_components/ds";

interface ProposalActionsProps {
  id: string;
  status: string;
}

export function ProposalActions({ id, status }: ProposalActionsProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const isDaoFinalized = status === "dao_finalized";
  if (isDaoFinalized) return null;

  async function handleFinalize() {
    setBusy(true);
    setErrorMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/works/proposals/${id}/dao-finalize`, {
        method: "POST",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "Request failed");
        setErrorMessage(text);
        return;
      }
      toast.success("Proposal finalized for DAO approval.");
      setOpen(false);
      setTimeout(() => router.refresh(), 600);
    } catch {
      setErrorMessage("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        DAO Finalize
      </button>
      <ConfirmDialog
        open={open}
        title="Finalize for DAO Approval"
        description="This will submit the proposal for DAO finalization. This action cannot be undone."
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
