"use client";

/**
 * Finance maker-checker action buttons (client). Each wraps the shared
 * ActionButton/ConfirmDialog primitive so irreversible postings require an
 * explicit confirmation + a reason (maker-checker). The "checker" role is
 * surfaced in the dialog copy; the action POSTs/PATCHes the real proxied
 * finance-service endpoint and refreshes the route on success.
 */
import { useRouter } from "next/navigation";
import { ActionButton } from "@/app/_components/ds";

async function postJson(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!(res.ok || res.status === 202)) {
    const text = await res.text().catch(() => "");
    let msg = `Request failed (${res.status}).`;
    try {
      const j = JSON.parse(text);
      msg = j?.message ?? j?.error ?? msg;
    } catch { if (text) msg = text; }
    throw new Error(msg);
  }
}

async function patchJson(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!(res.ok || res.status === 202)) {
    const text = await res.text().catch(() => "");
    let msg = `Request failed (${res.status}).`;
    try {
      const j = JSON.parse(text);
      msg = j?.message ?? j?.error ?? msg;
    } catch { if (text) msg = text; }
    throw new Error(msg);
  }
}

/* ── Payments: PFMS sync + release (treasury) ───────────────────── */
export function PaymentActions() {
  const router = useRouter();
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
          await postJson("/api/proxy/v1/finance/payments/eft", { action: "pfms-sync", reason });
        }}
        onSuccess={() => router.refresh()}
      />
      <ActionButton
        label="+ New Payment"
        className="btn primary"
        danger
        confirmTitle="Release a new payment?"
        confirmDescription="Releasing initiates an outward EFT/PFMS disbursement. The maker prepares it; a distinct checker must authorise. This is irreversible once submitted to the gateway."
        confirmLabel="Release payment"
        requireReason
        reasonLabel="Authorising officer & reason (maker-checker)"
        onConfirm={async (reason) => {
          await postJson("/api/proxy/v1/finance/payments/eft", { action: "release", reason });
        }}
        onSuccess={() => router.refresh()}
      />
    </>
  );
}

/* ── Sanctions: approve (financial sanction authority) ──────────── */
export function SanctionApproveAction({ id }: { id: string }) {
  const router = useRouter();
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
        await patchJson(`/api/proxy/v1/finance/sanctions/${id}/approve`, { reason });
      }}
      onSuccess={() => router.refresh()}
    />
  );
}

/* ── Bills: pass (pre-audit) and pay (treasury) ─────────────────── */
export function BillPassPayActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const s = (status ?? "").toLowerCase();
  const canPay = s === "passed" || s === "approved";
  return (
    <>
      <ActionButton
        label="Pass bill"
        className="btn ghost"
        confirmTitle="Pass this bill for payment?"
        confirmDescription="Passing certifies the bill has cleared 3-way match and pre-audit. The passing officer must differ from the submitter. Downstream payment can then be released."
        confirmLabel="Pass bill"
        requireReason
        reasonLabel="Pre-audit officer & reason"
        onConfirm={async (reason) => {
          await patchJson(`/api/proxy/v1/finance/bills/${id}/approve`, { decision: "pass", reason });
        }}
        onSuccess={() => router.refresh()}
      />
      <ActionButton
        label="Release payment"
        className="btn primary"
        danger
        disabled={!canPay}
        confirmTitle="Release payment for this bill?"
        confirmDescription="This authorises an irreversible outward disbursement against the passed bill. A distinct treasury officer must authorise (maker-checker)."
        confirmLabel="Release payment"
        requireReason
        reasonLabel="Treasury officer & reason"
        onConfirm={async (reason) => {
          await postJson("/api/proxy/v1/finance/payments/eft", { billId: id, action: "release", reason });
        }}
        onSuccess={() => router.refresh()}
      />
    </>
  );
}


/* ── List-level create actions (maker prepares; checker approves later) ── */
export function SanctionCreateAction() {
  const router = useRouter();
  return (
    <ActionButton
      label="+ New Sanction"
      className="btn primary"
      confirmTitle="Raise a new sanction?"
      confirmDescription="This records a draft administrative/financial sanction for budget check. A distinct approving authority must sanction it before any expenditure is committed (maker-checker)."
      confirmLabel="Create draft"
      requireReason
      reasonLabel="Proposing officer & purpose"
      onConfirm={async (reason) => {
        await postJson("/api/proxy/v1/finance/sanctions", { reason, status: "pending" });
      }}
      onSuccess={() => router.refresh()}
    />
  );
}

export function BillCreateAction() {
  const router = useRouter();
  return (
    <ActionButton
      label="+ New Bill"
      className="btn primary"
      confirmTitle="Submit a new bill?"
      confirmDescription="This lodges a bill for pre-audit and 3-way match. It must be passed by a distinct officer before payment can be released."
      confirmLabel="Submit bill"
      requireReason
      reasonLabel="Submitting officer & reason"
      onConfirm={async (reason) => {
        await postJson("/api/proxy/v1/finance/bills", { reason, status: "pending" });
      }}
      onSuccess={() => router.refresh()}
    />
  );
}
