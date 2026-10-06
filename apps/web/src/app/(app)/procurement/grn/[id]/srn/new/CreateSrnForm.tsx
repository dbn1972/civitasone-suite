"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toHumanError } from "@/lib/messages";
import { Button, ConfirmDialog } from "@/app/_components/ds";

type SrnItem = { itemCode: string; unit: string; receivedQty: number; acceptedQty: number };

function createError(status: number): string {
  // GAP-PROCUREMENT-GRN-DETAIL-SRN-NEW-05 — branch on status instead of using
  // the generic save copy for everything.
  if (status === 409) {
    const h = toHumanError("conflict", { area: "Store Receipt Note" });
    return `An SRN already exists for this GRN. ${h.next}`;
  }
  if (status === 403) return "You are not authorised to create a Store Receipt Note for this GRN.";
  const human = toHumanError("save", { area: "Store Receipt Note" });
  return `${human.what} ${human.next}`;
}

export function CreateSrnForm({
  grnId,
  storeOfficerLabel,
  grnNo,
  items = [],
}: {
  grnId: string;
  storeOfficerLabel: string;
  grnNo?: string;
  items?: SrnItem[];
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [receivedDate, setReceivedDate] = useState(today);
  const [remarks, setRemarks] = useState("");
  // GAP-PROCUREMENT-GRN-DETAIL-SRN-NEW-02 — default to Draft (not pre-armed to
  // sign). Signing is the irreversible payment gate; the officer opts in.
  const [signNow, setSignNow] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function doSubmit() {
    setStatus("submitting");
    setMessage("");
    try {
      const createRes = await fetch("/api/proxy/v1/inventory/srn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grnId, remarks: remarks.trim() || undefined }),
      });
      const createText = await createRes.text();
      if (!createRes.ok) {
        setStatus("error");
        setMessage(createError(createRes.status));
        return;
      }
      let created: { id?: string } = {};
      try { created = JSON.parse(createText) as { id?: string }; } catch { /* ignore */ }

      if (signNow) {
        // GAP-PROCUREMENT-GRN-DETAIL-SRN-NEW-01 — a sign that cannot proceed
        // (no id came back) is an error, not a silent skip: the clerk must not
        // believe the payment gate cleared.
        if (!created.id) {
          router.push(`/procurement/grn/${grnId}/srn?signFailed=1`);
          router.refresh();
          return;
        }
        const signRes = await fetch(`/api/proxy/v1/inventory/srn/${created.id}/sign`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            receivedAt: new Date(receivedDate).toISOString(),
            remarks: remarks.trim() || undefined,
          }),
        });
        if (!signRes.ok) {
          // The SRN was created but signing failed — land on the read view with
          // a flag so a banner tells the officer it is still a Draft and must be
          // signed again (GAP-PROCUREMENT-GRN-DETAIL-SRN-NEW-01).
          router.push(`/procurement/grn/${grnId}/srn?signFailed=1`);
          router.refresh();
          return;
        }
      }

      router.push(`/procurement/grn/${grnId}/srn`);
      router.refresh();
    } catch {
      setStatus("error");
      // GAP-PROCUREMENT-GRN-DETAIL-SRN-NEW-05 — network-specific copy, not a raw
      // exception echo.
      setMessage("Couldn't reach the server. Check your connection and try again.");
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // GAP-PROCUREMENT-GRN-DETAIL-SRN-NEW-02 — signing is irreversible, so gate it
    // behind a ConfirmDialog; creating a plain draft needs no confirmation.
    if (signNow) {
      setConfirmOpen(true);
      return;
    }
    void doSubmit();
  }

  return (
    <>
      <form className="card pad" onSubmit={handleSubmit} style={{ maxWidth: 640 }} noValidate>
        {items.length > 0 ? (
          <div style={{ marginBottom: 16 }}>
            <span className="label">Items being accepted{grnNo ? ` — ${grnNo}` : ""}</span>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl-editor" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th scope="col">Item code</th>
                    <th scope="col">Unit</th>
                    <th scope="col" className="num">Received</th>
                    <th scope="col" className="num">Accepted</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.itemCode}>
                      <td>{it.itemCode}</td>
                      <td>{it.unit}</td>
                      <td className="num">{it.receivedQty}</td>
                      <td className="num">{it.acceptedQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div className="fields">
          {/* GAP-PROCUREMENT-GRN-DETAIL-SRN-NEW-05 — a <label> must wrap a control;
              the store-officer display is read-only text, so it is a div. */}
          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <span className="label">Recorded as (from your session)</span>
            <span>{storeOfficerLabel}</span>
            <span style={{ fontSize: "0.75rem", color: "var(--muted, #6b7280)" }}>
              The server sets the authoritative store officer from your signed-in session.
            </span>
          </div>

          {/* GAP-PROCUREMENT-GRN-DETAIL-SRN-NEW-03 — the received date is only
              recorded when the SRN is signed; hide it when not signing so the
              entered value is not silently discarded. */}
          {signNow ? (
            <label className="field" htmlFor="srn-received-date" style={{ background: "#fff", padding: "13px 16px" }}>
              <span className="label">Received date</span>
              <input
                id="srn-received-date"
                type="date"
                max={today}
                value={receivedDate}
                onChange={(e) => setReceivedDate(e.target.value)}
                style={{ minHeight: 44 }}
              />
            </label>
          ) : (
            <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
              <span className="label">Received date</span>
              <span style={{ fontSize: "0.8125rem", color: "var(--muted, #6b7280)" }}>
                Recorded when the SRN is signed.
              </span>
            </div>
          )}

          <label className="field" htmlFor="srn-remarks" style={{ background: "#fff", padding: "13px 16px" }}>
            <span className="label">Remarks</span>
            <textarea
              id="srn-remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={3}
              placeholder="Condition of goods, any discrepancies noted at receipt"
              style={{ minHeight: 88 }}
            />
          </label>

          <label className="field" htmlFor="srn-sign-now" style={{ background: "#fff", padding: "13px 16px", flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input id="srn-sign-now" type="checkbox" checked={signNow} onChange={(e) => setSignNow(e.target.checked)} style={{ width: 18, height: 18 }} />
            <span className="label" style={{ margin: 0 }}>Sign now — confirms physical acceptance and clears the payment gate</span>
          </label>
        </div>

        <div role="status" aria-live="polite">
          {message ? (
            <p id="srn-form-message" role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, fontSize: "0.875rem", color: "#b91c1c" }}>{message}</p>
          ) : null}
        </div>
        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={status === "submitting"}>
            {status === "submitting" ? "Submitting…" : signNow ? "Sign & Submit" : "Create draft SRN"}
          </Button>
          <Link href={`/procurement/grn/${grnId}`} className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
        </div>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        title="Create and sign this SRN?"
        description={
          <>
            Signing confirms physical acceptance of {grnNo ? <strong>{grnNo}</strong> : "this GRN"} into
            store and clears the payment gate (GFR Rule 149). It cannot be un-signed.
          </>
        }
        confirmLabel="Sign & create SRN"
        busy={status === "submitting"}
        onConfirm={() => { setConfirmOpen(false); void doSubmit(); }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
