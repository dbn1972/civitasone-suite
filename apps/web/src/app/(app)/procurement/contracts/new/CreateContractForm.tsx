"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/formatters";

type VendorOption = { id: string; name: string };

export function CreateContractForm() {
  const router = useRouter();
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [contractNo, setContractNo] = useState("");
  const [title, setTitle] = useState("");
  const [value, setValue] = useState(0);
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [expiry, setExpiry] = useState("");
  const [poRef, setPoRef] = useState("");
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
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const valueMinor = Math.round(value * 100);
    if (!vendorId || !contractNo.trim() || !title.trim() || !expiry || valueMinor <= 0) {
      setStatus("error");
      setMessage("Vendor, contract no, title, a positive value and expiry date are required.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    const body = {
      contractNo: contractNo.trim(),
      vendorId,
      title: title.trim(),
      valueMinor,
      currency: "INR",
      startDate,
      expiry,
      poRef: poRef.trim() || undefined,
    };
    try {
      const res = await fetch("/api/proxy/v1/contract/contracts", {
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
      setStatus("accepted");
      setMessage("Contract created.");
      router.push("/procurement/contracts");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <form className="card pad" onSubmit={(e) => void handleSubmit(e)} style={{ maxWidth: 720 }} noValidate>
      <div className="fields">
        <label className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <span className="label">Vendor / counter-party *</span>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} required style={{ minHeight: 44 }}>
            {vendors.length === 0 ? <option value="">Loading vendors…</option> : null}
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="c-no">Contract no *</label>
          <input id="c-no" className="inp" value={contractNo} onChange={(e) => setContractNo(e.target.value)} required style={{ minHeight: 44 }} />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="c-title">Title *</label>
          <input id="c-title" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} required style={{ minHeight: 44 }} />
        </div>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="c-val">Contract value (₹) *</label>
          <input id="c-val" type="number" min={0} step="0.01" className="inp" value={value} onChange={(e) => setValue(Number(e.target.value))} required style={{ minHeight: 44 }} />
          <span style={{ fontSize: 12, color: "var(--mut)", marginTop: 4 }} aria-live="polite">{formatMoney(Math.max(0, Math.round(value * 100)))}</span>
        </div>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="c-po">PO reference</label>
          <input id="c-po" className="inp" value={poRef} onChange={(e) => setPoRef(e.target.value)} style={{ minHeight: 44 }} />
        </div>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="c-start">Start date *</label>
          <input id="c-start" type="date" className="inp" value={startDate} onChange={(e) => setStartDate(e.target.value)} required style={{ minHeight: 44 }} />
        </div>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="c-exp">Expiry date *</label>
          <input id="c-exp" type="date" className="inp" value={expiry} onChange={(e) => setExpiry(e.target.value)} required style={{ minHeight: 44 }} />
        </div>
      </div>

      <div role="status" aria-live="polite">
        {message ? (
          <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, fontSize: "0.875rem", color: status === "error" ? "#b91c1c" : "#047857" }}>{message}</p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={status === "submitting"}>
          {status === "submitting" ? "Creating…" : "Create contract"}
        </button>
        <Link href="/procurement/contracts" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
