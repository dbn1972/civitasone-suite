"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DataTable, Segmented, Button, ConfirmDialog, useConfirmAction } from "@/app/_components/ds";
import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";

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
};

const SEGMENTS = ["All", "Pending", "In-house"];

export function BookingsTable({ rows }: { rows: BookingRow[] }) {
  const router = useRouter();
  const [seg, setSeg] = useState("All");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [actionTarget, setActionTarget] = useState<BookingRow | null>(null);
  const [actionKind, setActionKind] = useState<"checkin" | "checkout">("checkin");

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
    const endpoint =
      actionKind === "checkin"
        ? `/api/proxy/v1/estab/room-bookings/${actionTarget.id}/checkin`
        : `/api/proxy/v1/estab/room-bookings/${actionTarget.id}/checkout`;
    const res = await fetch(endpoint, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(actionKind === "checkout" ? { chargesMinor: 0 } : {}),
    });
    if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
    setMessage(`${actionKind === "checkin" ? "Checked in" : "Checked out"}: ${actionTarget.guest}`);
    router.refresh();
  }

  const confirm = useConfirmAction({ onConfirm: () => executeAction() });

  function triggerAction(row: BookingRow, kind: "checkin" | "checkout") {
    setActionTarget(row);
    setActionKind(kind);
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
              if (r.statusRaw === "confirmed" || r.statusRaw === "pending") {
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
        title={actionKind === "checkin" ? "Confirm check-in?" : "Confirm check-out?"}
        description={
          actionKind === "checkin"
            ? `Check in ${actionTarget?.guest ?? "this guest"} to ${actionTarget?.room ?? "the room"}?`
            : `Check out ${actionTarget?.guest ?? "this guest"} from ${actionTarget?.room ?? "the room"}?`
        }
        confirmLabel={actionKind === "checkin" ? "Check in" : "Check out"}
        busy={confirm.busy}
        errorMessage={confirm.error}
        onConfirm={confirm.confirm}
        onCancel={confirm.cancel}
      />
    </>
  );
}
