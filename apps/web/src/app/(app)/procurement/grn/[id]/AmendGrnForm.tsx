"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Req 1.2 — GRN partial-delivery amendment. Only receivedQty/acceptedQty per
// line are editable; grnNo, vendorId, poRef stay immutable and are not part
// of this form at all. Mirrors CreateGRNForm.tsx conventions: "use client",
// useRouter + router.refresh() after success, and the /api/proxy pass-through.
type AmendLine = {
  lineId: string;
  itemCode: string;
  unit: string;
  receivedQty: number;
  acceptedQty: number;
};

export function AmendGrnForm({ grnId, items }: {
  grnId: string;
  items: Array<{ id?: string; itemCode: string; unit: string; receivedQty: number; acceptedQty: number }>;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<AmendLine[]>(
    items
      .filter((i): i is typeof i & { id: string } => Boolean(i.id))
      .map((i) => ({ lineId: i.id, itemCode: i.itemCode, unit: i.unit, receivedQty: i.receivedQty, acceptedQty: i.acceptedQty })),
  );
  const [status, setStatus] = useState<"idle" | "submitting" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  function updateLine(idx: number, patch: Partial<AmendLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (lines.length === 0) {
      setStatus("error");
      setMessage("This GRN has no line items to amend.");
      return;
    }
    for (const l of lines) {
      if (l.acceptedQty > l.receivedQty) {
        setStatus("error");
        setMessage(`Accepted quantity cannot exceed received quantity for ${l.itemCode}.`);
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
      const text = await res.text();
      if (!res.ok) {
        setStatus("error");
        setMessage(text || `Save failed (${res.status})`);
        return;
      }
      setStatus("saved");
      setMessage("GRN amended — quantities updated.");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <form className="card pad" onSubmit={(e) => void handleSubmit(e)} noValidate>
      <div style={{ overflowX: "auto" }}>
        <table className="tbl-editor" style={{ minWidth: 560, width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th scope="col">Item code</th>
              <th scope="col">Unit</th>
              <th scope="col" className="num">Received qty</th>
              <th scope="col" className="num">Accepted qty</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => (
              <tr key={l.lineId}>
                <td>{l.itemCode}</td>
                <td>{l.unit}</td>
                <td className="num">
                  <label className="sr-only" htmlFor={`amend-received-${idx}`}>Received qty, {l.itemCode}</label>
                  <input
                    id={`amend-received-${idx}`}
                    type="number"
                    min={0}
                    aria-required="true"
                    value={l.receivedQty}
                    onChange={(e) => updateLine(idx, { receivedQty: Number(e.target.value) })}
                    style={{ minHeight: 40, width: 100, textAlign: "right" }}
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
                    style={{ minHeight: 40, width: 100, textAlign: "right" }}
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
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={status === "submitting"}>
          {status === "submitting" ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
