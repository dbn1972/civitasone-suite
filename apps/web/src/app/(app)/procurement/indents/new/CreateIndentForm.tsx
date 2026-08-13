'use client';

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LineItemsEditor, emptyLineItem, type LineItem } from "../../_components/LineItemsEditor";
import { trackActivation } from "@/lib/activation";

type GfrBand = { id: string; name: string; notes: string; requiresTender: boolean };

export function CreateIndentForm() {
  const router = useRouter();

  const [indentNo] = useState("IND-" + Date.now().toString(36).toUpperCase());
  const [department, setDepartment] = useState("Finance");
  const [indentDate, setIndentDate] = useState(new Date().toISOString().slice(0, 10));
  const [requiredBy, setRequiredBy] = useState("");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [remarks, setRemarks] = useState("");
  const [items, setItems] = useState<LineItem[]>([emptyLineItem()]);
  const [modeBand, setModeBand] = useState<GfrBand | null>(null);
  const [status, setStatus] = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");

  // Dynamic GFR mode-band lookup when estimatedValue changes
  useEffect(() => {
    const parsed = parseFloat(estimatedValue);
    if (!estimatedValue || isNaN(parsed) || parsed <= 0) { setModeBand(null); return; }
    const estimatedValueMinor = Math.round(parsed * 100);
    let cancelled = false;
    fetch("/api/proxy/v1/procurement/gfr/mode-bands?estimatedValueMinor=" + estimatedValueMinor)
      .then((r) => r.json() as Promise<{ data: GfrBand[]; applicableMode?: string }>)
      .then((json) => {
        if (cancelled) return;
        const id = json.applicableMode;
        const band = id ? (json.data.find((b) => b.id === id) ?? null) : null;
        setModeBand(band);
      })
      .catch(() => { if (!cancelled) setModeBand(null); });
    return () => { cancelled = true; };
  }, [estimatedValue]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validItems = items.filter((it) => it.itemCode.trim() && it.description.trim());
    if (!department.trim() || validItems.length === 0) {
      setStatus("error");
      setMessage("Department and at least one complete line item are required.");
      return;
    }
    setStatus("submitting"); setMessage("");
    const body = {
      indentNo,
      department: department.trim(),
      indentDate: indentDate || new Date().toISOString().slice(0, 10),
      requiredBy: requiredBy || undefined,
      estimatedValueMinor: estimatedValue ? Math.round(parseFloat(estimatedValue) * 100) : undefined,
      remarks: remarks.trim() || undefined,
      items: validItems.map((it) => ({
        itemCode: it.itemCode.trim(),
        description: it.description.trim(),
        quantity: Math.max(1, it.quantity),
        unit: "nos",
        unitPriceMinor: Math.max(0, Math.round(it.unitPrice * 100)),
      })),
    };
    try {
      const res = await fetch("/api/proxy/v1/procurement/indents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) { setStatus("error"); setMessage(text || "Request failed"); return; }
      setStatus("accepted");
      trackActivation("first_transaction");
      setMessage("Indent submitted for approval via workflow.");
      router.push("/procurement/indents");
      router.refresh();
    } catch (err) {
      setStatus("error"); setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="card pad" style={{ maxWidth: 860 }} noValidate>
      <div className="fields">
        {/* Indent No — read-only, auto-generated */}
        <div className="field" style={{ background: "var(--panel)", padding: "13px 16px" }}>
          <label className="label" htmlFor="indentNo">Indent No (auto)</label>
          <input id="indentNo" className="inp mono" value={indentNo} readOnly style={{ minHeight: 44, cursor: "default", background: "var(--panel)" }} />
        </div>

        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="indentDate">Indent date *</label>
          <input id="indentDate" type="date" className="inp" value={indentDate} onChange={(e) => setIndentDate(e.target.value)} required style={{ minHeight: 44 }} />
        </div>

        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="department">Department *</label>
          <input id="department" className="inp" value={department} onChange={(e) => setDepartment(e.target.value)} required style={{ minHeight: 44 }} />
        </div>

        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="requiredBy">Required by date</label>
          <input id="requiredBy" type="date" className="inp" value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} style={{ minHeight: 44 }} />
        </div>

        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="estimatedValue">
            Estimated total value (INR)
            <span style={{ fontSize: 11, color: "var(--ink2)", marginLeft: 4 }}>— determines procurement mode</span>
          </label>
          <input id="estimatedValue" type="number" className="inp" value={estimatedValue} onChange={(e) => setEstimatedValue(e.target.value)} step="0.01" min="0" style={{ minHeight: 44 }} placeholder="e.g. 250000" />
          {modeBand ? (
            <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ background: modeBand.requiresTender ? "var(--warn)" : "var(--good)", color: "#fff", borderRadius: 3, padding: "2px 8px", fontSize: 12, fontWeight: 600 }}>
                {modeBand.id}
              </span>
              <span style={{ fontSize: 12, color: "var(--ink2)" }}>{modeBand.name} — {modeBand.notes}</span>
            </div>
          ) : estimatedValue && parseFloat(estimatedValue) > 0 ? (
            <span style={{ fontSize: 12, color: "var(--ink2)", marginTop: 4, display: "block" }}>Determining mode…</span>
          ) : null}
        </div>

        <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="remarks">Remarks</label>
          <textarea id="remarks" className="inp" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional remarks or justification" />
        </div>
      </div>

      <LineItemsEditor items={items} onChange={setItems} />

      <div role="status" aria-live="polite">
        {message ? (
          <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, color: status === "error" ? "var(--bad)" : "var(--good)", fontSize: "0.875rem" }}>
            {message}
          </p>
        ) : null}
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={status === "submitting"}>
          {status === "submitting" ? "Submitting…" : "Submit for approval"}
        </button>
        <Link href="/procurement/indents" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
