"use client";

import { useState } from "react";
import { ConfirmDialog, useToast, Button, AcceptedNotice } from "@/app/_components/ds";
import { useAcceptedWrite } from "@/lib/useAcceptedWrite";
import { PROPOSAL_WRITE_ROLES } from "@/lib/auth/workRoles";
import { useFormError } from "@/lib/useFormError";


interface ProposalActionsProps {
  id: string;
  status: string;
  roles: string[];
}

export function ProposalActions({ id, status, roles }: ProposalActionsProps) {
  // GAP-WORKS-PROPOSALS-DETAIL-09: follow the queued DAO-finalize through the proposal's own GET until its status
  // really is dao_finalized (page then refreshes). If the consumer never applies it the notice ends at "still
  // processing" with a manual refresh instead of silently looking done.
  const accepted = useAcceptedWrite<void, { status?: string }>({
    poll: async () => {
      const res = await fetch(`/api/proxy/v1/works/proposals/${id}`);
      if (!res.ok) throw new Error("not available");
      const body = (await res.json()) as { data?: { status?: string } };
      return { status: body.data?.status };
    },
    isDone: (p) => p.status === "dao_finalized",
  });
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const formError = useFormError("proposal");

  if (!roles.some((r) => (PROPOSAL_WRITE_ROLES as readonly string[]).includes(r))) return null;

  const isDaoFinalized = status === "dao_finalized";
  if (isDaoFinalized) return null;

  async function handleFinalize() {
    setBusy(true);
    setErrorMessage("");
    formError.clear();
    try {
      const res = await fetch(`/api/proxy/v1/works/proposals/${id}/dao-finalize`, {
        method: "POST",
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setErrorMessage(resolved.message);
        return;
      }
      // HTTP 202 Accepted — the DAO-finalize is queued, not yet applied, so we
      // say "submitted", not "finalized". The refresh below reflects the real,
      // server-confirmed status once the consumer has processed it.
      toast.success("Proposal submitted for DAO finalization. It will show as finalized once processed.");
      setOpen(false);
      void accepted.accept();
    } catch (caught) {
      setErrorMessage(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AcceptedNotice {...accepted.noticeProps} />
      <Button
        type="button"
        variant="primary"
        onClick={() => setOpen(true)}
        disabled={accepted.isBusy}
      >
        DAO Finalize
      </Button>
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
