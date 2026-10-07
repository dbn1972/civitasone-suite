"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionButton } from "../../../../_components/ds";
import { useToast } from "@/app/_components/ds/Toast";
import { useFormError } from "@/lib/useFormError";

/**
 * GAP-HELPDESK-INTERNAL-DETAIL-02: mutation controls for an internal ticket.
 * Uses the helpdesk-service transition contract
 * (POST /v1/helpdesk/tickets/:id/transition, body { status }, see
 * services/helpdesk-service/src/modules/tickets/routes.ts). The service state
 * machine is stepwise (open -> investigating -> resolved -> closed) and the
 * list/detail view collapses open/investigating into "Open", so both
 * "Start investigation" and "Resolve" are offered; an illegal step comes back
 * as a 422 and is shown as an error toast. The transition endpoint takes no
 * free-text reason, so none is collected here.
 */
export function InternalTicketActions({ ticketId, currentStatus }: { ticketId: string; currentStatus: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const formError = useFormError("ticket action");
  const [busy, setBusy] = useState(false);

  async function postTransition(status: "investigating" | "resolved" | "closed") {
    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/v1/helpdesk/tickets/${encodeURIComponent(ticketId)}/transition`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const err = await formError.fromResponse(res, "save");
        toast.error(err.message);
        return;
      }
      toast.success(`Ticket ${status === "resolved" ? "resolved" : status === "closed" ? "closed" : "moved to investigating"}.`);
      router.refresh();
    } catch (caught) {
      const err = formError.fromException("save", caught);
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const isOpen = currentStatus === "Open" || currentStatus === "In Progress";
  const isResolvable = isOpen;
  const isClosable = currentStatus === "Resolved";

  return (
    <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
      {isOpen ? (
        <ActionButton
          label="Start investigation"
          confirmTitle="Start investigating this ticket?"
          confirmDescription="Move this ticket to the investigating stage."
          disabled={busy}
          onConfirm={async () => { await postTransition("investigating"); }}
        />
      ) : null}
      {isResolvable ? (
        <ActionButton
          label="Resolve"
          className="btn primary"
          confirmTitle="Resolve this ticket?"
          confirmDescription="Mark this ticket as resolved."
          disabled={busy}
          onConfirm={async () => { await postTransition("resolved"); }}
        />
      ) : null}
      {isClosable ? (
        <ActionButton
          label="Close"
          confirmTitle="Close this ticket?"
          confirmDescription="Close the resolved ticket. It will no longer appear in the active queue."
          disabled={busy}
          onConfirm={async () => { await postTransition("closed"); }}
        />
      ) : null}
    </div>
  );
}
