"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type VendorOption = { id: string; name: string };
const INSPECTOR_ID = "00000000-0000-0000-0000-000000000099";

export function CreateGRNForm() {
  const router = useRouter();
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [poRef, setPoRef] = useState("PO/2026/001");
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10));
  const [itemCode, setItemCode] = useState("");
  const [poItemRef, setPoItemRef] = useState("procurement_po_item:11111111-0002-0000-0000-000000000003");
  const [orderedQty, setOrderedQty] = useState(10);
  const [receivedQty, setReceivedQty] = useState(10);
  const [acceptedQty, setAcceptedQty] = useState(10);
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
        setVendors(rows.filter((v) => v.id && v.name));
        if (rows[0]?.id) setVendorId(rows[0].id);
      } catch {
        /* optional */
      }
    })();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!vendorId || !poRef.trim() || !itemCode.trim() || !poItemRef.trim()) {
      setStatus("error");
      setMessage("Vendor, PO ref, item code and PO item ref are required.");
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
      items: [{
        poItemRef: poItemRef.trim(),
        itemCode: itemCode.trim(),
        orderedQty: Math.max(0, orderedQty),
        receivedQty: Math.max(0, receivedQty),
        acceptedQty: Math.max(0, acceptedQty),
        unit: "nos",
      }],
      inspection: {
        inspectorId: INSPECTOR_ID,
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
    <form className="card pad" onSubmit={(e) => void handleSubmit(e)} style={{ maxWidth: 640 }}>
      <div className="fields">
        <label className="field">
          <span className="label">PO reference</span>
          <input value={poRef} onChange={(e) => setPoRef(e.target.value)} required />
        </label>
        <label className="field">
          <span className="label">Vendor</span>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} required>
            {vendors.length === 0 ? <option value="">Loading vendors…</option> : null}
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">Received date</span>
          <input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">PO item ref</span>
          <input value={poItemRef} onChange={(e) => setPoItemRef(e.target.value)} required />
        </label>
        <label className="field">
          <span className="label">Item code</span>
          <input value={itemCode} onChange={(e) => setItemCode(e.target.value)} required />
        </label>
        <label className="field">
          <span className="label">Ordered qty</span>
          <input type="number" min={0} value={orderedQty} onChange={(e) => setOrderedQty(Number(e.target.value))} />
        </label>
        <label className="field">
          <span className="label">Received qty</span>
          <input type="number" min={0} value={receivedQty} onChange={(e) => setReceivedQty(Number(e.target.value))} />
        </label>
        <label className="field">
          <span className="label">Accepted qty</span>
          <input type="number" min={0} value={acceptedQty} onChange={(e) => setAcceptedQty(Number(e.target.value))} />
        </label>
        <label className="field">
          <span className="label">Inspection result</span>
          <select value={inspectionResult} onChange={(e) => setInspectionResult(e.target.value as typeof inspectionResult)}>
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
            <option value="pending">Pending</option>
          </select>
        </label>
        <label className="field">
          <span className="label">Inspection remarks</span>
          <input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </label>
      </div>
      {message ? (
        <p style={{ marginTop: 12, fontSize: "0.875rem", color: status === "error" ? "#b91c1c" : "#047857" }}>{message}</p>
      ) : null}
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button type="submit" className="btn primary" disabled={status === "submitting"}>
          {status === "submitting" ? "Submitting…" : "Record GRN"}
        </button>
        <Link href="/procurement/grn" className="btn ghost">Cancel</Link>
      </div>
    </form>
  );
}
