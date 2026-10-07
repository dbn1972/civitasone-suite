"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toHumanError } from "@/lib/messages";
import { Button } from "@/app/_components/ds";

type VendorOption = { id: string; name: string };
type POOption = { id: string; poNo: string; vendor?: string; vendorId?: string };
type POItem = { ref: string; itemCode: string; quantity: number; unit: string };

type GRNLine = {
  poItemRef: string;
  itemCode: string;
  orderedQty: number;
  receivedQty: number;
  acceptedQty: number;
  unit: string;
};

type LoadState = "loading" | "ready" | "error";

function emptyLine(): GRNLine {
  return { poItemRef: "", itemCode: "", orderedQty: 0, receivedQty: 0, acceptedQty: 0, unit: "nos" };
}

// DOM-002 — this form only records RECEIPT (what came in against a PO); it does
// not collect an inspection verdict (a separate second-actor step on the detail
// page). GAP-PROCUREMENT-GRN-NEW-01..05 additions:
//  - 01: grnNo is NOT generated client-side anymore; the server issues a gapless
//        sequence number and the body omits grnNo entirely.
//  - 02: no PO/vendor auto-select; selecting a PO lays out one row per PO item
//        with ordered prefilled but received/accepted blank, and submit is
//        blocked when nothing was received.
//  - 03: received/accepted quantities are validated (non-negative integers,
//        accepted<=received, received<=ordered) with per-row messages; unit
//        comes from the PO item, not a hard-coded "nos".
//  - 04: Vendor is locked to the PO's vendor when the PO carries one.
//  - 05: load failures surface an inline alert with Retry instead of a stuck
//        "Loading…" placeholder.
export function CreateGRNForm() {
  const router = useRouter();
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [vendorLocked, setVendorLocked] = useState(false);
  const [pos, setPos] = useState<POOption[]>([]);
  const [poId, setPoId] = useState("");
  const [poRef, setPoRef] = useState("");
  const [poItems, setPoItems] = useState<POItem[]>([]);
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<GRNLine[]>([emptyLine()]);
  const [status, setStatus] = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});

  // GAP-PROCUREMENT-GRN-NEW-05 — explicit per-list load state.
  const [vendorsLoad, setVendorsLoad] = useState<LoadState>("loading");
  const [posLoad, setPosLoad] = useState<LoadState>("loading");
  const [poItemsLoad, setPoItemsLoad] = useState<LoadState>("ready");

  const nextLineRowId = useRef(0);
  const [lineRowIds, setLineRowIds] = useState<number[]>(() => [nextLineRowId.current++]);
  const lineKeyFor = (idx: number) => lineRowIds[idx] ?? idx;

  const fetchVendors = useCallback(async (signal?: AbortSignal) => {
    setVendorsLoad("loading");
    try {
      const res = await fetch("/api/proxy/v1/procurement/vendors?limit=100", { signal });
      if (!res.ok) { setVendorsLoad("error"); return; }
      const body = await res.json() as { data?: VendorOption[] } | VendorOption[];
      const rows = Array.isArray(body) ? body : (body.data ?? []);
      setVendors(rows.filter((v) => v.id && v.name));
      setVendorsLoad("ready");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setVendorsLoad("error");
    }
  }, []);

  const fetchPos = useCallback(async (signal?: AbortSignal) => {
    setPosLoad("loading");
    try {
      const res = await fetch("/api/proxy/v1/procurement/pos?limit=100", { signal });
      if (!res.ok) { setPosLoad("error"); return; }
      const body = await res.json() as { data?: POOption[] } | POOption[];
      const rows = Array.isArray(body) ? body : (body.data ?? []);
      setPos(rows.filter((p) => p.id && p.poNo));
      setPosLoad("ready");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setPosLoad("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchVendors(controller.signal);
    void fetchPos(controller.signal);
    return () => controller.abort();
  }, [fetchVendors, fetchPos]);

  async function selectPo(po: POOption) {
    setPoId(po.id);
    setPoRef(po.poNo);
    // GAP-PROCUREMENT-GRN-NEW-04 — lock the vendor to the PO's vendor when known.
    if (po.vendorId) {
      setVendorId(po.vendorId);
      setVendorLocked(true);
    } else {
      setVendorLocked(false);
    }
    setPoItemsLoad("loading");
    try {
      const res = await fetch(`/api/proxy/v1/procurement/pos/${po.id}`);
      if (!res.ok) { setPoItems([]); setPoItemsLoad("error"); return; }
      const detail = await res.json() as Record<string, unknown>;
      // PO vendorId may only come back on the detail, not the list row.
      if (!po.vendorId && typeof detail.vendorId === "string") {
        setVendorId(detail.vendorId);
        setVendorLocked(true);
      }
      const raw = Array.isArray(detail.items) ? detail.items
        : Array.isArray(detail.lineItems) ? detail.lineItems : [];
      const items: POItem[] = raw
        .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
        .map((i) => ({
          ref: String(i.poItemRef ?? i.id ?? `procurement_po_item:${po.id}:${String(i.itemCode ?? "")}`),
          itemCode: String(i.itemCode ?? ""),
          quantity: typeof i.quantity === "number" ? i.quantity : 0,
          unit: typeof i.unit === "string" && i.unit ? i.unit : "nos",
        }))
        .filter((i) => i.itemCode);
      setPoItems(items);
      setPoItemsLoad("ready");
      // GAP-PROCUREMENT-GRN-NEW-02 — one row per PO item, ordered prefilled but
      // received/accepted left blank (0) so the clerk must enter them.
      if (items.length > 0) {
        setLines(items.map((it) => ({ poItemRef: it.ref, itemCode: it.itemCode, orderedQty: it.quantity, receivedQty: 0, acceptedQty: 0, unit: it.unit })));
        setLineRowIds(items.map(() => nextLineRowId.current++));
      } else {
        setLines([emptyLine()]);
        setLineRowIds([nextLineRowId.current++]);
      }
    } catch {
      setPoItems([]);
      setPoItemsLoad("error");
    }
  }

  function updateLine(idx: number, patch: Partial<GRNLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((p) => [...p, emptyLine()]);
    setLineRowIds((ids) => [...ids, nextLineRowId.current++]);
  }
  function removeLine(idx: number) {
    setLines((p) => (p.length > 1 ? p.filter((_, i) => i !== idx) : p));
    setLineRowIds((ids) => (ids.length > 1 ? ids.filter((_, i) => i !== idx) : ids));
  }
  function pickItem(idx: number, ref: string) {
    const it = poItems.find((p) => p.ref === ref);
    updateLine(idx, it ? { poItemRef: it.ref, itemCode: it.itemCode, orderedQty: it.quantity, unit: it.unit } : { poItemRef: ref });
  }

  // GAP-PROCUREMENT-GRN-NEW-03 — explicit quantity validation (shared shape with
  // the server's assertQtyValid). Returns per-row messages.
  function validateLines(valid: GRNLine[]): Record<number, string> {
    const errs: Record<number, string> = {};
    valid.forEach((l, idx) => {
      if (!Number.isInteger(l.receivedQty) || !Number.isInteger(l.acceptedQty) || l.receivedQty < 0 || l.acceptedQty < 0) {
        errs[idx] = `Quantities for ${l.itemCode || `row ${idx + 1}`} must be non-negative whole numbers.`;
      } else if (l.acceptedQty > l.receivedQty) {
        errs[idx] = `Accepted (${l.acceptedQty}) cannot exceed received (${l.receivedQty}) for ${l.itemCode || `row ${idx + 1}`}.`;
      } else if (l.orderedQty > 0 && l.receivedQty > l.orderedQty) {
        errs[idx] = `Received (${l.receivedQty}) cannot exceed ordered (${l.orderedQty}) for ${l.itemCode || `row ${idx + 1}`}.`;
      }
    });
    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setRowErrors({});
    const valid = lines.filter((l) => l.poItemRef.trim() && l.itemCode.trim());
    if (!vendorId || !poRef.trim() || valid.length === 0) {
      setStatus("error");
      setMessage("Vendor, purchase order and at least one line item are required.");
      return;
    }
    // GAP-PROCUREMENT-GRN-NEW-02 — a GRN with nothing received is not a receipt.
    if (valid.every((l) => l.receivedQty <= 0)) {
      setStatus("error");
      setMessage("Enter the received quantity for at least one item before recording the GRN.");
      return;
    }
    const errs = validateLines(valid);
    if (Object.keys(errs).length > 0) {
      setRowErrors(errs);
      setStatus("error");
      setMessage("Please correct the highlighted quantities.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    // GAP-PROCUREMENT-GRN-NEW-01 — no client-generated grnNo; the server issues it.
    const body = {
      poRef: poRef.trim(),
      vendorId,
      receivedDate,
      items: valid.map((l) => ({
        poItemRef: l.poItemRef.trim(),
        itemCode: l.itemCode.trim(),
        orderedQty: Math.max(0, l.orderedQty),
        receivedQty: Math.max(0, l.receivedQty),
        acceptedQty: Math.max(0, l.acceptedQty),
        unit: l.unit || "nos",
      })),
    };
    try {
      const res = await fetch("/api/proxy/v1/procurement/grns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        const human = toHumanError("save", { area: "goods receipt note" });
        setStatus("error");
        setMessage(`${human.what} ${human.next}`);
        return;
      }
      let parsed: { id?: string } = {};
      try { parsed = JSON.parse(text) as { id?: string }; } catch { /* ignore */ }
      setStatus("accepted");
      setMessage("GRN recorded as received — awaiting inspection by a separate officer before the three-way match is computed.");
      router.push(parsed.id ? `/procurement/grn/${parsed.id}` : "/procurement/grn");
      router.refresh();
    } catch {
      setStatus("error");
      setMessage("Couldn't reach the server. Check your connection and try again.");
    }
  }

  const listsBusy = vendorsLoad === "loading" || posLoad === "loading";
  const listsErrored = vendorsLoad === "error" || posLoad === "error";

  function poPlaceholder(): string {
    if (posLoad === "loading") return "Loading POs…";
    if (posLoad === "error") return "Couldn't load — use Retry";
    return pos.length === 0 ? "No purchase orders found" : "Select purchase order";
  }
  function vendorPlaceholder(): string {
    if (vendorsLoad === "loading") return "Loading vendors…";
    if (vendorsLoad === "error") return "Couldn't load — use Retry";
    return vendors.length === 0 ? "No vendors found" : "Select vendor";
  }

  const selectedVendorName = vendors.find((v) => v.id === vendorId)?.name;

  return (
    <form className="card pad" onSubmit={(e) => void handleSubmit(e)} style={{ maxWidth: 860 }} noValidate>
      {listsErrored ? (
        <div role="alert" style={{ marginBottom: 12, padding: "10px 12px", border: "1px solid #fecaca", borderRadius: 8, background: "#fef2f2" }}>
          <span style={{ fontSize: "0.875rem", color: "#b91c1c" }}>
            Couldn&apos;t load {vendorsLoad === "error" ? "vendors" : ""}{vendorsLoad === "error" && posLoad === "error" ? " and " : ""}{posLoad === "error" ? "purchase orders" : ""}.
          </span>{" "}
          <Button type="button" variant="ghost" size="sm" onClick={() => { if (vendorsLoad === "error") void fetchVendors(); if (posLoad === "error") void fetchPos(); }}>Retry</Button>
        </div>
      ) : null}

      <div className="fields">
        <label className="field" htmlFor="grn-po" style={{ background: "#fff", padding: "13px 16px" }}>
          <span className="label">Purchase order *</span>
          <select id="grn-po" value={poId} onChange={(e) => { const p = pos.find((x) => x.id === e.target.value); if (p) void selectPo(p); }} required aria-required="true" aria-describedby={status === "error" ? "grn-form-message" : undefined} style={{ minHeight: 44 }}>
            <option value="">{poPlaceholder()}</option>
            {pos.map((p) => (
              <option key={p.id} value={p.id}>{p.poNo}{p.vendor ? ` — ${p.vendor}` : ""}</option>
            ))}
          </select>
        </label>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <span className="label">Vendor *</span>
          {vendorLocked ? (
            // GAP-PROCUREMENT-GRN-NEW-04 — vendor is derived from the PO; shown as
            // read-only text so it cannot diverge from the PO's vendor.
            <span>{selectedVendorName ?? "Set from purchase order"}</span>
          ) : (
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} required aria-required="true" aria-label="Vendor *" aria-describedby={status === "error" ? "grn-form-message" : undefined} style={{ minHeight: 44 }}>
              <option value="">{vendorPlaceholder()}</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          )}
        </div>
        <label className="field" htmlFor="grn-received-date" style={{ background: "#fff", padding: "13px 16px" }}>
          <span className="label">Received date</span>
          <input id="grn-received-date" type="date" max={new Date().toISOString().slice(0, 10)} value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} style={{ minHeight: 44 }} />
        </label>
      </div>

      <fieldset style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 14, margin: "8px 0 0" }}>
        <legend style={{ fontSize: 12, fontWeight: 700, padding: "0 6px" }}>Received line items</legend>
        {poItemsLoad === "error" ? (
          <p role="alert" style={{ fontSize: "0.875rem", color: "#b45309", marginTop: 0 }}>
            Couldn&apos;t load the PO&apos;s items — you can still enter them manually below.
          </p>
        ) : null}
        <div style={{ overflowX: "auto" }}>
          <table className="tbl-editor" style={{ minWidth: 760, width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th scope="col">PO item</th>
                <th scope="col">Item code</th>
                <th scope="col">Unit</th>
                <th scope="col" className="num">Ordered</th>
                <th scope="col" className="num">Received</th>
                <th scope="col" className="num">Accepted</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr key={lineKeyFor(idx)}>
                  <td>
                    <label className="sr-only" htmlFor={`g-item-${idx}`}>PO item, row {idx + 1}</label>
                    {poItems.length > 0 ? (
                      <select id={`g-item-${idx}`} value={l.poItemRef} onChange={(e) => pickItem(idx, e.target.value)} required aria-required="true" style={{ minHeight: 40, width: "100%" }}>
                        <option value="">Select item…</option>
                        {poItems.map((it) => <option key={it.ref} value={it.ref}>{it.itemCode}</option>)}
                      </select>
                    ) : (
                      <input id={`g-item-${idx}`} value={l.poItemRef} onChange={(e) => updateLine(idx, { poItemRef: e.target.value })} placeholder="PO item ref" required aria-required="true" style={{ minHeight: 40, width: "100%" }} />
                    )}
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`g-code-${idx}`}>Item code, row {idx + 1}</label>
                    <input id={`g-code-${idx}`} value={l.itemCode} onChange={(e) => updateLine(idx, { itemCode: e.target.value })} required aria-required="true" aria-describedby={rowErrors[idx] ? `g-row-err-${idx}` : (status === "error" ? "grn-form-message" : undefined)} style={{ minHeight: 40, width: "100%" }} />
                    {rowErrors[idx] ? <span id={`g-row-err-${idx}`} role="alert" style={{ display: "block", fontSize: "0.75rem", color: "#b91c1c" }}>{rowErrors[idx]}</span> : null}
                  </td>
                  <td>{l.unit}</td>
                  <td className="num">{l.orderedQty}</td>
                  <td className="num"><input type="number" min={0} step={1} aria-label={`Received qty row ${idx + 1}`} value={l.receivedQty} onChange={(e) => updateLine(idx, { receivedQty: Number(e.target.value) })} style={{ minHeight: 40, width: 80, textAlign: "end" }} /></td>
                  <td className="num"><input type="number" min={0} step={1} aria-label={`Accepted qty row ${idx + 1}`} value={l.acceptedQty} onChange={(e) => updateLine(idx, { acceptedQty: Number(e.target.value) })} style={{ minHeight: 40, width: 80, textAlign: "end" }} /></td>
                  <td>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(idx)} disabled={lines.length <= 1} aria-label={`Remove line item ${idx + 1}`} style={{ minHeight: 40 }}>Remove</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={addLine} style={{ marginTop: 10, minHeight: 40 }}>+ Add line item</Button>
      </fieldset>

      <div role="status" aria-live="polite">
        {message ? (
          <p id="grn-form-message" role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, fontSize: "0.875rem", color: status === "error" ? "#b91c1c" : "#047857" }}>{message}</p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={status === "submitting" || listsBusy}>
          {status === "submitting" ? "Submitting…" : "Record GRN"}
        </Button>
        <Link href="/procurement/grn" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
