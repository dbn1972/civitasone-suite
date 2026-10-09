"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

/**
 * GAP2-PROJECTS-MEMBERS-06: a role-gated Remove control for a project member,
 * backed by DELETE /v1/projects/:id/members/:memberId (project-service, which
 * audits the removal in its consumer transaction). Membership was previously
 * add-only from the UI despite the "add/remove members" page intent. The page
 * only renders this for a user whose role the server would accept
 * (PROJECT_WRITE_ROLES); the server remains the authority and 403s others.
 */
export function RemoveMemberButton({
  projectId,
  memberId,
  memberLabel,
}: {
  projectId: string;
  memberId: string;
  memberLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [removed, setRemoved] = useState(false);
  const formError = useFormError("project member");

  async function handleConfirm() {
    setBusy(true);
    setErrorMessage(undefined);
    try {
      const res = await fetch(`/api/proxy/v1/projects/${projectId}/members/${memberId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setErrorMessage((await formError.fromResponse(res, "save")).message);
        setBusy(false);
        return;
      }
      setBusy(false);
      setOpen(false);
      setRemoved(true);
      router.refresh();
    } catch (caught) {
      setErrorMessage(formError.fromException("save", caught).message);
      setBusy(false);
    }
  }

  if (removed) {
    return (
      <span role="status" aria-live="polite" style={{ fontSize: 12, color: "var(--ink2)" }}>
        Removed
      </span>
    );
  }

  return (
    <>
      <Button
        variant="secondary"
        style={{ minHeight: 32, fontSize: "0.8125rem" }}
        onClick={(e) => {
          e.stopPropagation();
          setErrorMessage(undefined);
          setOpen(true);
        }}
      >
        Remove
      </Button>
      {open && (
        <ConfirmDialog
          open
          title="Remove member"
          description={<>Remove <strong>{memberLabel}</strong> from this project? This can be undone by adding them again.</>}
          confirmLabel="Remove"
          busy={busy}
          errorMessage={errorMessage}
          onConfirm={() => void handleConfirm()}
          onCancel={() => {
            if (!busy) setOpen(false);
          }}
        />
      )}
    </>
  );
}
