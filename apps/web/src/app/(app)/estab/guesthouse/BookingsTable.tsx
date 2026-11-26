"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DataTable, Segmented, Button, ConfirmDialog, useConfirmAction } from "@/app/_components/ds";
import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { parseRupeesToPaise } from "@/lib/money";
import { useEstabT } from "@/lib/estab/useEstabT";

export type BookingRow = {
  id: string;
  bookingNo: string;
  guest: string;
  department: string;
  room: string;
  checkIn: string;
  checkOut: string;
  status: string;
  statusRaw: string;
  /** Officer who raised the booking; the approver must be someone else (maker-checker). */
  requestedBy?: string;
};

const SEGMENTS = ["All", "Pending", "In-house"];

export function BookingsTable({ rows, canOperate = false, canApprove = false, viewerId = null }: {
  rows: BookingRow[]; canOperate?: boolean; canApprove?: boolean; viewerId?: string | null;
}) {
  const router = useRouter();
  const t = useEstabT();
  const [seg, setSeg] = useState("All");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [actionTarget, setActionTarget] = useState<BookingRow | null>(null);
  const [actionKind, setActionKind] = useState<"checkin" | "checkout" | "approve" | "reject">("checkin");
  const [reason, setReason] = useState("");
  // Charges collected at check-out, as the officer typed them (rupees). Converted to integer paise with
  // string arithmetic only (never a float): "1500.50" -> 150050. Blank is not 0; the officer states it.
  const [charges, setCharges] = useState("");
  const chargesPaise = parseRupeesToPaise(charges, { allowZero: true });
  const chargesMinor =
    chargesPaise !== null && Number.isSafeInteger(Number(chargesPaise)) ? Number(chargesPaise) : null;

  const filtered = rows.filter((r) => {
    switch (seg) {
      case "Pending":
        return r.statusRaw === "pending" || r.statusRaw === "confirmed";
      case "In-house":
        return r.statusRaw === "checked_in";
      default:
        return true;
    }
  });

  // GAP-ESTAB-GUESTHOUSE-01: transition actions — the backend exposes
  // check-in / check-out endpoints but the web previously had no UI for them.
  async function executeAction() {
    if (!actionTarget) return;
    setMessage(""); setError("");
    const base = `/api/proxy/v1/estab/room-bookings/${actionTarget.id}`;
    const endpoint = `${base}/${actionKind}`;
    const decision = actionKind === "approve" || actionKind === "reject";
    // The charges are what the officer entered at check-out; no tariff is applied or assumed here.
    if (actionKind === "checkout" && chargesMinor === null) throw new Error(t("ghChargesInvalid"));
    const res = await fetch(endpoint, {
      method: decision ? "POST" : "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        actionKind === "checkout" ? { chargesMinor } : actionKind === "reject" ? { reason: reason.trim() } : {},
      ),
    });
    if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
    const done = { checkin: "Checked in", checkout: "Checked out", approve: "Approved", reject: "Rejected" }[actionKind];
    setMessage(`${done}: ${actionTarget.guest}`);
    router.refresh();
  }

  const confirm = useConfirmAction({ onConfirm: () => executeAction() });

  function triggerAction(row: BookingRow, kind: "checkin" | "checkout" | "approve" | "reject") {
    setActionTarget(row);
    setActionKind(kind);
    setCharges("");
    setReason("");
    confirm.trigger();
  }

  return (
    <>
      <div className="card-h">
        <h3>Bookings</h3>
        <Segmented options={SEGMENTS} value={seg} onChange={setSeg} />
      </div>
      {message ? <div role="status" className="pad" style={{ color: "var(--good)", fontSize: 13 }}>{message}</div> : null}
      {error ? <div role="alert" className="pad" style={{ color: "var(--bad)", fontSize: 13 }}>{error}</div> : null}
      <DataTable<BookingRow>
        columns={[
          { key: "bookingNo", label: "Ref" },
          { key: "guest", label: "Guest" },
          { key: "department", label: "Department" },
          { key: "room", label: "Room" },
          { key: "checkIn", label: "Check-in" },
          { key: "checkOut", label: "Check-out" },
          { key: "status", label: "Status", cellType: "status" },
          {
            key: "id",
            label: "Actions",
            render: (r) => {
              // GAP-ESTAB-GUESTHOUSE-01: only establishment officers see check-in/out
              // (estab-service 403s every other role on these endpoints).
              if (!canOperate) return <>—</>;
              // Approve / Reject: server enforces a different officer than the requester (403 otherwise).
              if (r.statusRaw === "pending") {
                if (!canApprove || (viewerId && r.requestedBy === viewerId)) return <>Awaiting approval</>;
                return (
                  <>
                    <Button type="button" variant="ghost" onClick={() => triggerAction(r, "approve")}>Approve</Button>
                    <Button type="button" variant="ghost" onClick={() => triggerAction(r, "reject")}>Reject</Button>
                  </>
                );
              }
              if (r.statusRaw === "confirmed") {
                return (
                  <Button type="button" variant="ghost" onClick={() => triggerAction(r, "checkin")}>
                    Check in
                  </Button>
                );
              }
              if (r.statusRaw === "checked_in") {
                return (
                  <Button type="button" variant="ghost" onClick={() => triggerAction(r, "checkout")}>
                    Check out
                  </Button>
                );
              }
              return <>—</>;
            },
          },
        ]}
        rows={filtered}
        sortable
        filterable
        filterPlaceholder="Filter bookings…"
        pageSize={10}
      />
      <ConfirmDialog
        open={confirm.open}
        title={{ checkin: "Confirm check-in?", checkout: "Confirm check-out?", approve: "Approve this booking?", reject: "Reject this booking?" }[actionKind]}
        description={{
          checkin: `Check in ${actionTarget?.guest ?? "this guest"} to ${actionTarget?.room ?? "the room"}?`,
          checkout: `Check out ${actionTarget?.guest ?? "this guest"} from ${actionTarget?.room ?? "the room"}?`,
          approve: `Approve ${actionTarget?.guest ?? "this guest"}'s booking for ${actionTarget?.room ?? "the room"}?`,
          reject: `Reject ${actionTarget?.guest ?? "this guest"}'s booking for ${actionTarget?.room ?? "the room"}? The reason is recorded.`,
        }[actionKind]}
        confirmLabel={{ checkin: "Check in", checkout: "Check out", approve: "Approve", reject: "Reject" }[actionKind]}
        busy={confirm.busy}
        confirmDisabled={(actionKind === "checkout" && chargesMinor === null) || (actionKind === "reject" && reason.trim().length < 3)}
        errorMessage={confirm.error}
        onConfirm={confirm.confirm}
        onCancel={confirm.cancel}
      >
        {actionKind === "reject" ? (
          <div className="cd-field">
            <label htmlFor="gh-reject-reason">Reason for rejection</label>
            <input
              id="gh-reject-reason"
              type="text"
              autoComplete="off"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-required="true"
            />
          </div>
        ) : null}
        {actionKind === "checkout" ? (
          <div className="cd-field">
            <label htmlFor="gh-checkout-charges">{t("ghCheckoutCharges")}</label>
            <input
              id="gh-checkout-charges"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={charges}
              onChange={(e) => setCharges(e.target.value)}
              aria-required="true"
              aria-invalid={charges.trim() !== "" && chargesMinor === null ? true : undefined}
              aria-describedby="gh-checkout-charges-help"
            />
            <p id="gh-checkout-charges-help" style={{ fontSize: 12, margin: "4px 0 0", color: "var(--muted)" }}>
              {t("ghCheckoutChargesHelp")}
            </p>
            {charges.trim() !== "" && chargesMinor === null ? (
              <p role="alert" style={{ fontSize: 12, margin: "4px 0 0", color: "var(--bad)" }}>{t("ghChargesInvalid")}</p>
            ) : null}
          </div>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
