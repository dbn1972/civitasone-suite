"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFormError } from "@/lib/useFormError";
import { Button } from "@/app/_components/ds";

// Req 1.2 — GRN partial-delivery amendment. Only receivedQty/acceptedQty per
// line are editable; grnNo, vendorId, poRef stay immutable and are not part
// of this form at all. Mirrors CreateGRNForm.tsx conventions: "use client",
// useRouter + router.refresh() after success, and the /api/proxy pass-through.
//
// GAP-PROCUREMENT-GRN-DETAIL-04 — the table now also shows the read-only PO
// item ref and Ordered quantity so the officer can see what was ordered while
// editing received/accepted (previously those columns only appeared on the
// read-only view). Validation blocks received > ordered, and any input line
// without an id is surfaced as a visible warning instead of being silently
// dropped.
type AmendLine = {
  lineId: string;
  itemCode: string;
  poItemRef: string;
  unit: string;
  orderedQty: number;
  receivedQty: number;
  acceptedQty: number;
};

type InputItem = {
  id?: string;
  itemCode: string;
  poItemRef: string;
  unit: string;
  orderedQty: number;
  receivedQty: number;
  acceptedQty: number;
};

export function AmendGrnForm({ grnId, items }: {
  grnId: string;
  items: Array<InputItem>;
}) {
  const router = useRouter();
  // GAP-PROCUREMENT-GRN-DETAIL-04 — lines without a persisted id cannot be
  // amended (the PATCH keys on lineId); list their codes as a warning rather
  // than dropping them silently.
  const skipped = items.filter((i) => !i.id).map((i) => i.itemCode).filter(Boolean);
  const [lines, setLines] = useState<AmendLine[]>(
    items
      .filter((i): i is InputItem & { id: string } => Boolean(i.id))
      .map((i) => ({
        lineId: i.id,
        itemCode: i.itemCode,
        poItemRef: i.poItemRef,
        unit: i.unit,
        orderedQty: i.orderedQty,
        receivedQty: i.receivedQty,
        acceptedQty: i.acceptedQty,
      })),
  );
  const [status, setStatus] = useState<"idle" | "submitting" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const formError = useFormError("GRN amendment");

  function updateLine(idx: number, patch: Partial<AmendLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (lines.length === 0) {
      setStatus("error");
      setMessage("This GRN has no amendable line items.");
      return;
    }
    for (const l of lines) {
      if (l.acceptedQty > l.receivedQty) {
        setStatus("error");
        setMessage(`Accepted quantity cannot exceed received quantity for ${l.itemCode}.`);
        return;
      }
      // GAP-PROCUREMENT-GRN-DETAIL-04 — a GRN records what was received against
      // a PO; receiving more than was ordered is blocked (the server re-checks
      // via assertQtyValid's over-accept cap, this is the up-front client gate).
      if (l.orderedQty > 0 && l.receivedQty > l.orderedQty) {
        setStatus("error");
        setMessage(`Received quantity (${l.receivedQty}) cannot exceed ordered quantity (${l.orderedQty}) for ${l.itemCode}.`);
        return;
      }
    }
    setStatus("submitting");
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/procurement/grns/${grnId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lines: lines.map((l) => ({
            lineId: l.lineId,
            receivedQty: Math.max(0, l.receivedQty),
            acceptedQty: Math.max(0, l.acceptedQty),
          })),
        }),
      });
      if (!res.ok) {
        setStatus("error");
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      setStatus("saved");
      setMessage("GRN amended — quantities updated.");
      router.refresh();
    } catch (caught) {
      setStatus("error");
      setMessage(formError.fromException("save", caught).message);
    }
  }

  return (
    <form className="card pad" onSubmit={(e) => void handleSubmit(e)} noValidate>
      {skipped.length > 0 ? (
        <p role="alert" style={{ marginBottom: 12, fontSize: "0.875rem", color: "#b45309" }}>
          {skipped.length} line{skipped.length > 1 ? "s" : ""} cannot be amended because they have no
          saved line id: {skipped.join(", ")}.
        </p>
      ) : null}
      <div style={{ overflowX: "auto" }}>
        <table className="tbl-editor" style={{ minWidth: 680, width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th scope="col">Item code</th>
              <th scope="col">PO item</th>
              <th scope="col">Unit</th>
              <th scope="col" className="num">Ordered</th>
              <th scope="col" className="num">Received qty</th>
              <th scope="col" className="num">Accepted qty</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => (
              <tr key={l.lineId}>
                <td>{l.itemCode}</td>
                <td className="mono">{l.poItemRef}</td>
                <td>{l.unit}</td>
                <td className="num">{l.orderedQty}</td>
                <td className="num">
                  <label className="sr-only" htmlFor={`amend-received-${idx}`}>Received qty, {l.itemCode}</label>
                  <input
                    id={`amend-received-${idx}`}
                    type="number"
                    min={0}
                    aria-required="true"
                    value={l.receivedQty}
                    onChange={(e) => updateLine(idx, { receivedQty: Number(e.target.value) })}
                    style={{ minHeight: 40, width: 100, textAlign: "end" }}
                  />
                </td>
                <td className="num">
                  <label className="sr-only" htmlFor={`amend-accepted-${idx}`}>Accepted qty, {l.itemCode}</label>
                  <input
                    id={`amend-accepted-${idx}`}
                    type="number"
                    min={0}
                    aria-required="true"
                    value={l.acceptedQty}
                    onChange={(e) => updateLine(idx, { acceptedQty: Number(e.target.value) })}
                    style={{ minHeight: 40, width: 100, textAlign: "end" }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div role="status" aria-live="polite">
        {message ? (
          <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, fontSize: "0.875rem", color: status === "error" ? "#b91c1c" : "#047857" }}>{message}</p>
        ) : null}
      </div>

      <div style={{ marginTop: 16 }}>
        <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={status === "submitting" || lines.length === 0}>
          {status === "submitting" ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
