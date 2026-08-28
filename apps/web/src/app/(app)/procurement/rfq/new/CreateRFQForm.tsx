"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toHumanError } from "@/lib/messages";

type IndentOption = { id: string; indentNo?: string; department?: string };
type VendorOption = { id: string; name: string };

export function CreateRFQForm() {
  const router = useRouter();
  const [indents, setIndents] = useState<IndentOption[]>([]);
  const [indentId, setIndentId] = useState("");
  const [title, setTitle] = useState("");
  const [closingDate, setClosingDate] = useState("");
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/proxy/v1/procurement/indents?limit=100");
        if (res.ok) {
          const body = await res.json() as { data?: IndentOption[] } | IndentOption[];
          const rows = Array.isArray(body) ? body : (body.data ?? []);
          const clean = rows.filter((i) => i.id);
          setIndents(clean);
          if (clean[0]?.id) setIndentId(clean[0].id);
        }
      } catch { /* optional */ }
    })();
    void (async () => {
      try {
        const res = await fetch("/api/proxy/v1/procurement/vendors?limit=100");
        if (res.ok) {
          const body = await res.json() as { data?: VendorOption[] } | VendorOption[];
          const rows = Array.isArray(body) ? body : (body.data ?? []);
          setVendors(rows.filter((v) => v.id && v.name));
        }
      } catch { /* optional */ }
    })();
  }, []);

  function toggleVendor(id: string) {
    setInvited((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!indentId || title.trim().length < 1 || !closingDate || invited.size === 0) {
      setStatus("error");
      setMessage("Source indent, title, closing date and at least one invited vendor are required.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    const rfqNo = `RFQ/${new Date().getFullYear()}/${String(Math.floor(Math.random() * 900) + 100)}`;
    const body = {
      rfqNo,
      title: title.trim(),
      indentRef: `procurement_indent:${indentId}`,
      closingDate,
      vendorIds: [...invited],
    };
    try {
      const res = await fetch("/api/proxy/v1/procurement/rfqs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        const human = toHumanError("save", { area: "RFQ" });
        setStatus("error");
        setMessage(`${human.what} ${human.next}`);
        return;
      }
      let parsed: { id?: string } = {};
      try { parsed = JSON.parse(text) as { id?: string }; } catch { /* ignore */ }
      setStatus("accepted");
      setMessage("RFQ issued to the selected vendors.");
      router.push(parsed.id ? `/procurement/rfq/${parsed.id}` : "/procurement/rfq");
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
          <span className="label">Source indent *</span>
          <select value={indentId} onChange={(e) => setIndentId(e.target.value)} required style={{ minHeight: 44 }}>
            {indents.length === 0 ? <option value="">Loading indents…</option> : null}
            {indents.map((i) => <option key={i.id} value={i.id}>{i.indentNo ?? i.id}{i.department ? ` — ${i.department}` : ""}</option>)}
          </select>
        </label>
        <label className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <span className="label">Closing date *</span>
          <input type="date" value={closingDate} onChange={(e) => setClosingDate(e.target.value)} required style={{ minHeight: 44 }} />
        </label>
        <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="r-title">RFQ title *</label>
          <input id="r-title" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} required style={{ minHeight: 44 }} />
        </div>
      </div>

      <fieldset style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 14, margin: "8px 0 0" }}>
        <legend style={{ fontSize: 12, fontWeight: 700, padding: "0 6px" }}>Invite vendors * ({invited.size} selected)</legend>
        {vendors.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--mut)", margin: 0 }}>Loading vendors…</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
            {vendors.map((v) => (
              <label key={v.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, minHeight: 36 }}>
                <input type="checkbox" checked={invited.has(v.id)} onChange={() => toggleVendor(v.id)} />
                {v.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div role="status" aria-live="polite">
        {message ? (
          <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, fontSize: "0.875rem", color: status === "error" ? "#b91c1c" : "#047857" }}>{message}</p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={status === "submitting"}>
          {status === "submitting" ? "Issuing…" : "Issue RFQ"}
        </button>
        <Link href="/procurement/rfq" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
