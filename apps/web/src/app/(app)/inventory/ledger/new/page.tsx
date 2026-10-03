"use client";

/**
 * New Stock Entry (receipt / issue / transfer / adjustment).
 * POSTs to the real stock-service endpoint POST /v1/stock/entries via the
 * gateway proxy. Body shape (per createEntryBody):
 *   { entryType, postingDate, fromWarehouseId?, toWarehouseId?, notes?,
 *     items: [{ itemId, qty, rateMinor }] }
 * The item is chosen with the shared ItemPicker (searches the item master and the stock
 * register together; a linked pair is one item). Only items that exist on the stock side
 * can be posted here, and the stock-service id is what the entry carries. An optional
 * ?itemId= query param (a stock item id, passed from a stock item detail page) preselects it.
 */
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader, ConfirmDialog, useConfirmAction } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { ItemPicker } from "@/app/_components/ItemPicker";
import { resolveStockItemEntry } from "@/lib/entityAdapters/item";
import type { PickerEntry } from "../../linkHelpers";

const ENTRY_LABELS: Record<string, string> = {
  receipt: "Receipt",
  issue: "Issue",
  transfer: "Transfer",
  adjustment: "Adjustment",
};

const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;

export default function NewStockEntryPage() {
  const router = useRouter();
  const params = useSearchParams();
  const presetItemId = params.get("itemId") ?? "";

  const [picked, setPicked] = useState<PickerEntry | null>(null);
  const [loadError, setLoadError] = useState("");
  const [entryType, setEntryType] = useState<"receipt" | "issue" | "transfer" | "adjustment">("receipt");
  const [postingDate, setPostingDate] = useState(new Date().toISOString().slice(0, 10));
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const formError = useFormError("stock item");

  // The stock item id carried by the entry: the stock side of whatever was picked.
  const itemId = picked?.stockItemId ?? "";

  // A preselected stock item (?itemId=) is shown as the single merged item it belongs to.
  useEffect(() => {
    if (!presetItemId) return;
    let active = true;
    (async () => {
      try {
        const entry = await resolveStockItemEntry(presetItemId);
        if (active) {
          if (entry) setPicked(entry);
          else setLoadError(formError.fromException("load").message);
        }
      } catch {
        if (active) setLoadError(formError.fromException("load").message);
      }
    })();
    return () => { active = false; };
    // formError.fromException is stable (useCallback on a fixed area string).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetItemId]);

  // The actual irreversible post — gated behind the confirm dialog below.
  async function postEntry(reason?: string) {
    setMessage("");
    setIsError(false);
    const qtyNum = Math.round(Number(qty || "0"));
    const rateMinor = Math.round(Number(rate || "0") * 100);
    const wh = warehouseId.trim();
    const trimmedReason = reason?.trim();
    const combinedNotes = [notes.trim(), trimmedReason ? `Reason: ${trimmedReason}` : ""]
      .filter(Boolean)
      .join(" — ");
    const body: Record<string, unknown> = {
      entryType,
      postingDate,
      notes: combinedNotes || undefined,
      items: [{ itemId, qty: qtyNum, rateMinor }],
    };
    if (wh) {
      if (entryType === "issue") body.fromWarehouseId = wh;
      else body.toWarehouseId = wh;
    }
    const res = await fetch("/api/proxy/v1/stock/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!(res.ok || res.status === 202)) throw new Error((await formError.fromResponse(res, "save")).message);
  }

  const post = useConfirmAction({
    onConfirm: postEntry,
    onSuccess: () => {
      setIsError(false);
      setMessage("Stock entry posted.");
      setQty("");
      setRate("");
      router.refresh();
      setTimeout(() => router.push("/inventory/reconcile"), 700);
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setIsError(false);
    post.trigger();
  }

  return (
    <>
      <PageHeader
        title="New Stock Entry"
        subtitle="Record a receipt, issue, transfer or adjustment."
        back="/inventory/reconcile"
        backLabel="Stock Ledger"
      />
      {message ? (
        <div role={isError ? "alert" : "status"} aria-live={isError ? "assertive" : "polite"} className="banner" style={{ background: isError ? "#fef2f2" : "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      {loadError ? (
        <div role="alert" aria-live="assertive" className="banner" style={{ background: "#fef2f2", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{loadError}</div>
      ) : null}
      <div className="card">
        <form onSubmit={submit} className="pad">
          <div className="fields">
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="se-type">Entry type</label>
              <select id="se-type" value={entryType} onChange={(e) => setEntryType(e.target.value as typeof entryType)} style={inputStyle}>
                <option value="receipt">Receipt</option>
                <option value="issue">Issue</option>
                <option value="transfer">Transfer</option>
                <option value="adjustment">Adjustment</option>
              </select>
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="se-date">Posting date</label>
              <input id="se-date" required type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="se-item">Item</label>
              <div style={{ width: "100%" }}>
                <ItemPicker
                  id="se-item"
                  value={picked?.key ?? null}
                  onChange={setPicked}
                  initialEntry={picked ?? undefined}
                  masters="stock"
                  clearable
                />
              </div>
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="se-qty">Quantity</label>
              <input id="se-qty" required type="number" min="1" step="1" value={qty} onChange={(e) => setQty(e.target.value)} style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="se-rate">Rate (₹ per unit)</label>
              <input id="se-rate" type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="se-wh">Warehouse ID (optional)</label>
              <input id="se-wh" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} placeholder="UUID" style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="se-notes">Notes</label>
              <input id="se-notes" value={notes} onChange={(e) => setNotes(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <button type="submit" className="btn primary" disabled={post.busy || !itemId} aria-busy={post.busy} style={{ marginTop: 12 }}>
            {post.busy ? "Posting…" : "Post entry"}
          </button>
        </form>
      </div>
      <ConfirmDialog
        open={post.open}
        title="Post this stock entry?"
        description={`This posts a ${ENTRY_LABELS[entryType] ?? entryType} of ${qty || "0"} unit(s) to the stock ledger and cannot be undone. Provide a reason for the audit trail.`}
        confirmLabel="Post entry"
        cancelLabel="Cancel"
        danger
        requireReason
        reasonLabel="Reason / reference"
        busy={post.busy}
        errorMessage={post.error}
        onConfirm={post.confirm}
        onCancel={post.cancel}
      />
    </>
  );
}
