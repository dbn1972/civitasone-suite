"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type VendorOption = { id: string; name: string };
type POOption = { id: string; poNo: string; vendor?: string; vendorId?: string };
type POItem = { ref: string; itemCode: string; quantity: number };

type GRNLine = {
  poItemRef: string;
  itemCode: string;
  orderedQty: number;
  receivedQty: number;
  acceptedQty: number;
};

function emptyLine(): GRNLine {
  return { poItemRef: "", itemCode: "", orderedQty: 0, receivedQty: 0, acceptedQty: 0 };
}

export function CreateGRNForm({ inspectorId }: { inspectorId: string }) {
  const router = useRouter();
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [pos, setPos] = useState<POOption[]>([]);
  const [poId, setPoId] = useState("");
  const [poRef, setPoRef] = useState("");
  const [poItems, setPoItems] = useState<POItem[]>([]);
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<GRNLine[]>([emptyLine()]);
  const [inspectionResult, setInspectionResult] = useState<"pass" | "fail" | "pending">("pass");
  const [remarks, setRemarks] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/proxy/v1/procurement/vendors?limit=100");
        if (!res.ok) return;
        const body = await res.json() as { data?: VendorOption[] } | VendorOption[];
        const rows = Array.isArray(body) ? body : (body.data ?? []);
        const clean = rows.filter((v) => v.id && v.name);
        setVendors(clean);
        if (clean[0]?.id) setVendorId(clean[0].id);
      } catch { /* optional */ }
    })();
    void (async () => {
      try {
        const res = await fetch("/api/proxy/v1/procurement/pos?limit=100");
        if (!res.ok) return;
        const body = await res.json() as { data?: POOption[] } | POOption[];
        const rows = Array.isArray(body) ? body : (body.data ?? []);
        const clean = rows.filter((p) => p.id && p.poNo);
        setPos(clean);
        if (clean[0]) selectPo(clean[0]);
      } catch { /* optional */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function selectPo(po: POOption) {
    setPoId(po.id);
    setPoRef(po.poNo);
    if (po.vendorId) setVendorId(po.vendorId);
    try {
      const res = await fetch(`/api/proxy/v1/procurement/pos/${po.id}`);
      if (!res.ok) { setPoItems([]); return; }
      const detail = await res.json() as Record<string, unknown>;
      const raw = Array.isArray(detail.items) ? detail.items
        : Array.isArray(detail.lineItems) ? detail.lineItems : [];
      const items: POItem[] = raw
        .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
        .map((i) => ({
          ref: String(i.poItemRef ?? i.id ?? `procurement_po_item:${po.id}:${String(i.itemCode ?? "")}`),
          itemCode: String(i.itemCode ?? ""),
          quantity: typeof i.quantity === "number" ? i.quantity : 0,
        }))
        .filter((i) => i.itemCode);
      setPoItems(items);
      if (items.length > 0) {
        setLines([{ poItemRef: items[0].ref, itemCode: items[0].itemCode, orderedQty: items[0].quantity, receivedQty: items[0].quantity, acceptedQty: items[0].quantity }]);
      }
    } catch {
      setPoItems([]);
    }
  }

  function updateLine(idx: number, patch: Partial<GRNLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function pickItem(idx: number, ref: string) {
    const it = poItems.find((p) => p.ref === ref);
    updateLine(idx, it ? { poItemRef: it.ref, itemCode: it.itemCode, orderedQty: it.quantity } : { poItemRef: ref });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const valid = lines.filter((l) => l.poItemRef.trim() && l.itemCode.trim());
    if (!vendorId || !poRef.trim() || valid.length === 0) {
      setStatus("error");
      setMessage("Vendor, purchase order and at least one line item are required.");
      return;
    }
    if (!inspectorId) {
      setStatus("error");
      setMessage("Could not determine the inspector from your session. Please sign in again.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    const grnNo = `GRN/${new Date().getFullYear()}/${String(Math.floor(Math.random() * 900) + 100)}`;
    const body = {
      grnNo,
      poRef: poRef.trim(),
      vendorId,
      receivedDate,
      items: valid.map((l) => ({
        poItemRef: l.poItemRef.trim(),
        itemCode: l.itemCode.trim(),
        orderedQty: Math.max(0, l.orderedQty),
        receivedQty: Math.max(0, l.receivedQty),
        acceptedQty: Math.max(0, l.acceptedQty),
        unit: "nos",
      })),
      inspection: {
        inspectorId,
        result: inspectionResult,
        remarks: remarks.trim() || undefined,
      },
    };
    try {
      const res = await fetch("/api/proxy/v1/procurement/grns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        setStatus("error");
        setMessage(text || `Create failed (${res.status})`);
        return;
      }
      const parsed = JSON.parse(text) as { id?: string };
      setStatus("accepted");
      setMessage("GRN recorded — three-way match computed on acceptance.");
      router.push(parsed.id ? `/procurement/grn/${parsed.id}` : "/procurement/grn");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <form className="card pad" onSubmit={(e) => void handleSubmit(e)} style={{ maxWidth: 860 }} noValidate>
      <div className="fields">
        <label className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <span className="label">Purchase order *</span>
          <select value={poId} onChange={(e) => { const p = pos.find((x) => x.id === e.target.value); if (p) void selectPo(p); }} required aria-required="true" aria-describedby={status === "error" ? "grn-form-message" : undefined} style={{ minHeight: 44 }}>
            {pos.length === 0 ? <option value="">Loading POs…</option> : null}
            {pos.map((p) => (
              <option key={p.id} value={p.id}>{p.poNo}{p.vendor ? ` — ${p.vendor}` : ""}</option>
            ))}
          </select>
        </label>
        <label className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <span className="label">Vendor *</span>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} required aria-required="true" aria-describedby={status === "error" ? "grn-form-message" : undefined} style={{ minHeight: 44 }}>
            {vendors.length === 0 ? <option value="">Loading vendors…</option> : null}
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </label>
        <label className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <span className="label">Received date</span>
          <input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} style={{ minHeight: 44 }} />
        </label>
      </div>

      <fieldset style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 14, margin: "8px 0 0" }}>
        <legend style={{ fontSize: 12, fontWeight: 700, padding: "0 6px" }}>Received line items</legend>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl-editor" style={{ minWidth: 720, width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th scope="col">PO item</th>
                <th scope="col">Item code</th>
                <th scope="col" className="num">Ordered</th>
                <th scope="col" className="num">Received</th>
                <th scope="col" className="num">Accepted</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr key={idx}>
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
                    <input id={`g-code-${idx}`} value={l.itemCode} onChange={(e) => updateLine(idx, { itemCode: e.target.value })} required aria-required="true" aria-describedby={status === "error" ? "grn-form-message" : undefined} style={{ minHeight: 40, width: "100%" }} />
                  </td>
                  <td className="num"><input type="number" min={0} aria-label={`Ordered qty row ${idx + 1}`} value={l.orderedQty} onChange={(e) => updateLine(idx, { orderedQty: Number(e.target.value) })} style={{ minHeight: 40, width: 80, textAlign: "right" }} /></td>
                  <td className="num"><input type="number" min={0} aria-label={`Received qty row ${idx + 1}`} value={l.receivedQty} onChange={(e) => updateLine(idx, { receivedQty: Number(e.target.value) })} style={{ minHeight: 40, width: 80, textAlign: "right" }} /></td>
                  <td className="num"><input type="number" min={0} aria-label={`Accepted qty row ${idx + 1}`} value={l.acceptedQty} onChange={(e) => updateLine(idx, { acceptedQty: Number(e.target.value) })} style={{ minHeight: 40, width: 80, textAlign: "right" }} /></td>
                  <td>
                    <button type="button" className="btn ghost sm" onClick={() => setLines((p) => p.length > 1 ? p.filter((_, i) => i !== idx) : p)} disabled={lines.length <= 1} aria-label={`Remove line item ${idx + 1}`} style={{ minHeight: 40 }}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="btn ghost sm" onClick={() => setLines((p) => [...p, emptyLine()])} style={{ marginTop: 10, minHeight: 40 }}>+ Add line item</button>
      </fieldset>

      <div className="fields" style={{ marginTop: 12 }}>
        <label className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <span className="label">Inspection result</span>
          <select value={inspectionResult} onChange={(e) => setInspectionResult(e.target.value as typeof inspectionResult)} style={{ minHeight: 44 }}>
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
            <option value="pending">Pending</option>
          </select>
        </label>
        <label className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <span className="label">Inspection remarks</span>
          <input value={remarks} onChange={(e) => setRemarks(e.target.value)} style={{ minHeight: 44 }} />
        </label>
      </div>

      <div role="status" aria-live="polite">
        {message ? (
          <p id="grn-form-message" role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, fontSize: "0.875rem", color: status === "error" ? "#b91c1c" : "#047857" }}>{message}</p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={status === "submitting"}>
          {status === "submitting" ? "Submitting…" : "Record GRN"}
        </button>
        <Link href="/procurement/grn" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
