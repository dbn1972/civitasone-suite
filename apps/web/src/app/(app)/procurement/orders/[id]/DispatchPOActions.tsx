"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog, Button, Field, Select, Input, Textarea } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

const DISPATCH_MODES = [
  { value: "portal", label: "Vendor portal" },
  { value: "email", label: "Email" },
  { value: "gem", label: "GeM" },
  { value: "courier", label: "Courier" },
  { value: "hand", label: "By hand" },
  { value: "other", label: "Other" },
] as const;

/**
 * GAP-PROCUREMENT-ORDERS-DETAIL-03: dispatch is an irreversible vendor-facing
 * command. It must be (a) hidden from roles that can only read POs
 * (`canDispatchRole`, computed server-side — the service also 403s them), and
 * (b) status-aware — the hint shown when it isn't dispatchable now explains
 * WHY per status instead of always saying "Approve via workflow inbox".
 * The officer can also record how it was sent (mode), the expected delivery
 * date and a free-text note instead of a fixed "Dispatched from web UI".
 */
export function DispatchPOActions({
  poId,
  status,
  canDispatchRole = true,
}: {
  poId: string;
  status: string;
  canDispatchRole?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<string>("portal");
  const [expectedDelivery, setExpectedDelivery] = useState("");
  const [note, setNote] = useState("");
  const formError = useFormError("purchase order dispatch");

  const canDispatch = status === "approved";

  // Status-aware hint when the PO cannot be dispatched now. draft/cancelled/
  // fully_received no longer wrongly say "Approve via workflow inbox".
  if (!canDispatch) {
    let hint: React.ReactNode = null;
    if (status === "pending") {
      hint = <>Awaiting approval — the PO can be dispatched once approved.</>;
    } else if (status === "draft") {
      hint = <>Submit this PO for approval first; it can be dispatched once approved.</>;
    } else if (status === "dispatched" || status === "partial_grn" || status === "fully_received") {
      hint = <>Already dispatched to the vendor.</>;
    } else if (status === "cancelled" || status === "closed") {
      hint = null; // nothing to say for a terminal PO
    } else if (status === "gem_placed") {
      hint = <>Placed on GeM — fulfilment is tracked via the GeM order.</>;
    }
    if (!hint) return null;
    return (
      <p style={{ fontSize: "0.875rem", color: "#64748b", margin: 0 }} role="note">
        {hint}
      </p>
    );
  }

  // Dispatchable by status, but this user's role is read-only: say so plainly
  // rather than offering a control the server will 403.
  if (!canDispatchRole) {
    return (
      <p style={{ fontSize: "0.875rem", color: "#64748b", margin: 0 }} role="note">
        Dispatch is restricted to procurement officers.
      </p>
    );
  }

  async function dispatch() {
    setBusy(true);
    setError(undefined);
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/procurement/pos/${poId}/dispatch`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          expectedDelivery: expectedDelivery || undefined,
          notes: note.trim() || `Dispatched via ${mode}`,
        }),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setOpen(false);
      // `/dispatch` is a 202-accepted async command — the PO's status may not be
      // "dispatched" yet when this resolves. Report what actually happened
      // (accepted for processing); the refreshed StatusPill shows the real state.
      setMessage("Dispatch request submitted. The status above will update to “Dispatched” once processing completes.");
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
      <Button
        type="button"
        variant="primary"
        style={{ minHeight: 44 }}
        onClick={() => { setError(undefined); setMessage(""); setOpen(true); }}
      >
        Dispatch to vendor
      </Button>
      <span role="status" aria-live="polite" style={{ fontSize: "0.8rem", color: "#047857" }}>{message}</span>

      <ConfirmDialog
        open={open}
        title="Dispatch this PO to the vendor?"
        description="This issues the purchase order to the vendor and cannot be undone."
        confirmLabel="Dispatch"
        danger
        busy={busy}
        errorMessage={error}
        onConfirm={() => { void dispatch().catch(() => {}); }}
        onCancel={() => { if (!busy) { setOpen(false); setError(undefined); } }}
      >
        <div style={{ display: "grid", gap: 12, textAlign: "start", marginTop: 8 }}>
          <Field label="Dispatch mode">
            <Select value={mode} onChange={(e) => setMode(e.target.value)}>
              {DISPATCH_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
          </Field>
          <Field label="Expected delivery date">
            <Input type="date" value={expectedDelivery} onChange={(e) => setExpectedDelivery(e.target.value)} />
          </Field>
          <Field label="Note (optional)">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. courier docket no, contact person…" />
          </Field>
        </div>
      </ConfirmDialog>
    </div>
  );
}
