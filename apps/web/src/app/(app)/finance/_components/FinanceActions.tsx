"use client";

/**
 * Finance maker-checker action buttons (client). Each wraps the shared
 * ActionButton/ConfirmDialog primitive so irreversible postings require an
 * explicit confirmation + a reason (maker-checker). The "checker" role is
 * surfaced in the dialog copy; the action POSTs/PATCHes the real proxied
 * finance-service endpoint and refreshes the route on success.
 *
 * These endpoints are CQRS commands that return 202 Accepted — the work is
 * queued, not finished, when the request resolves. So on success we do NOT
 * claim "released"/"approved"; we tell the officer the request was SUBMITTED
 * for processing (an honest 202) via a toast, then refresh so the status
 * updates when the read model catches up. Without this the dialog just closed
 * over an unchanged page and the officer could not tell if anything happened
 * (and might re-submit an irreversible disbursement).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ActionButton, useToast } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";

/**
 * Plain-language failure message for a failed finance maker-checker command.
 * postJson/patchJson are plain async helpers shared across several exported
 * components below, not a component or hook, so they can't call the
 * useFormError hook; toHumanError is the same catalogued-message building
 * block that hook is built on -- never the backend's own message/error text
 * or the raw HTTP status. `area` names the specific action (e.g. "payment",
 * "sanction") for a more specific summary line. See
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-003/UX-016.
 */
function financeActionError(area: string): string {
  const human = toHumanError("save", { area });
  return `${human.what} ${human.next}`;
}

async function postJson(url: string, body: unknown, area = "request"): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!(res.ok || res.status === 202)) {
    throw new Error(financeActionError(area));
  }
}

async function patchJson(url: string, body: unknown, area = "request"): Promise<void> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!(res.ok || res.status === 202)) {
    throw new Error(financeActionError(area));
  }
}

/* ── Payments: PFMS sync + release (treasury) ───────────────────── */
export function PaymentActions() {
  const router = useRouter();
  const { toast } = useToast();
  return (
    <>
      <ActionButton
        label="PFMS Sync"
        className="btn ghost"
        confirmTitle="Sync the payment register with PFMS?"
        confirmDescription="This reconciles released payments against the PFMS gateway. It may move funds for queued instructions and cannot be reversed from here."
        confirmLabel="Run sync"
        requireReason
        reasonLabel="Reason / approving authority"
        onConfirm={async (reason) => {
          await postJson("/api/proxy/v1/finance/payments/eft", { action: "pfms-sync", reason }, "PFMS sync");
        }}
        onSuccess={() => { toast.info("PFMS sync submitted — the register updates as instructions settle."); router.refresh(); }}
      />
    </>
  );
}

/* ── Sanctions: approve (financial sanction authority) ──────────── */
export function SanctionApproveAction({ id }: { id: string }) {
  const router = useRouter();
  const { toast } = useToast();
  return (
    <ActionButton
      label="Approve sanction"
      className="btn primary"
      danger
      confirmTitle="Approve this sanction?"
      confirmDescription="Approval commits budget against the sanctioned head and authorises downstream bills/payments. The approving officer must be distinct from the proposer (maker-checker). This cannot be undone."
      confirmLabel="Approve"
      requireReason
      reasonLabel="Approving authority & reason"
      onConfirm={async (reason) => {
        await patchJson(`/api/proxy/v1/finance/sanctions/${id}/approve`, { reason }, "sanction approval");
      }}
      onSuccess={() => { toast.info("Approval submitted — the sanction status updates once processing completes."); router.refresh(); }}
    />
  );
}

/* ── Bills: pass (pre-audit) and pay (treasury) ─────────────────── */

/**
 * GAP-FINANCE-EXPENDITURE-BILLS-DETAIL-02: whether "Pass bill" may be offered.
 * A bill can only be passed while it is still awaiting pre-audit AND its
 * 3-way match is complete (finance-service rejects a pass without both PO and
 * GRN references). The backend stays the final authority; this just stops the
 * UI inviting a paid / already-passed / mismatched bill to be passed again.
 */
export function billPassBlockedReason(status: string, threeWayMatch?: string): string | null {
  const s = (status ?? "").toLowerCase();
  if (!["submitted", "pending", "under_review"].includes(s)) {
    return "This bill is no longer awaiting pre-audit, so it cannot be passed.";
  }
  if (threeWayMatch !== undefined && threeWayMatch !== "matched") {
    return "The 3-way match (PO, GRN, invoice) is not complete, so this bill cannot be passed yet.";
  }
  return null;
}

export function BillPassPayActions({ id, status, threeWayMatch }: { id: string; status: string; threeWayMatch?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const s = (status ?? "").toLowerCase();
  const canPay = s === "passed"; // finance-service emits "passed" (a pass maps approved -> passed)
  const passBlocked = billPassBlockedReason(status, threeWayMatch);
  return (
    <>
      <span title={passBlocked ?? undefined}>
        <ActionButton
          label="Pass bill"
          className="btn ghost"
          disabled={passBlocked !== null}
          confirmTitle="Pass this bill for payment?"
          confirmDescription="Passing certifies the bill has cleared 3-way match and pre-audit. The passing officer must differ from the submitter. Downstream payment can then be released."
          confirmLabel="Pass bill"
          requireReason
          reasonLabel="Pre-audit officer & reason"
          onConfirm={async (reason) => {
            // approveBillBody carries the officer's note in `notes`.
            await patchJson(`/api/proxy/v1/finance/bills/${id}/approve`, { notes: reason }, "bill");
          }}
          onSuccess={() => { toast.info("Bill passing submitted for processing."); router.refresh(); }}
        />
      </span>
      {passBlocked ? <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{passBlocked}</span> : null}
      {canPay ? (
        // Releasing a payment needs the DDO, mode and the bill's net amount --
        // collected (and confirmed) on the payment form, not a one-line reason.
        <Link href={`/finance/payments/new?billId=${encodeURIComponent(id)}`} className="btn primary">
          Release payment
        </Link>
      ) : null}
    </>
  );
}


/* ── List-level create actions (maker prepares; checker approves later) ── */
// SanctionCreateAction removed (GAP-FINANCE-BUDGET-SANCTIONS-01): it POSTed
// { reason, status } which never matched createSanctionBody; the list page
// now links to the real form at /finance/budget/sanctions/new.
