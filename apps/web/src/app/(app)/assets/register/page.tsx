"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const DEFAULT_CATEGORY = "77777777-0001-0000-0000-000000000001";

export default function RegisterAssetPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    code: "",
    assetType: "fixed",
    acquisitionCost: "",
    location: "",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const costMinor = Math.round(Number(form.acquisitionCost || "0") * 100);
      const res = await fetch("/api/proxy/v1/asset/assets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          code: form.code || `AST/${new Date().getFullYear()}/${Math.floor(Math.random() * 9000 + 1000)}`,
          categoryId: DEFAULT_CATEGORY,
          assetType: form.assetType,
          acquisitionCost: costMinor,
          acquisitionDate: new Date().toISOString().slice(0, 10),
          location: form.location || undefined,
        }),
      });
      const body = await res.json().catch(() => ({})) as { id?: string };
      if (!res.ok) throw new Error(await res.text());
      setMessage("Asset registered.");
      if (body.id) setTimeout(() => router.push(`/assets/${body.id}`), 600);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Register failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <a className="back" href="/assets/list">← Back</a>
      <div className="ph" style={{ marginTop: 6 }}>
        <h1>Register Asset</h1>
        <div className="sub">Manual capitalization — Oracle/SAP-style asset master create.</div>
      </div>
      {message ? <div className="banner" style={{ background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div> : null}
      <div className="card">
        <form onSubmit={submit} className="pad">
          <div className="fields">
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l">Name</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l">Asset code</label>
              <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="Auto-generated if blank" style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l">Type</label>
              <select value={form.assetType} onChange={(e) => setForm({ ...form, assetType: e.target.value })} style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" }}>
                <option value="fixed">Fixed</option>
                <option value="infra">Infrastructure</option>
                <option value="it">IT</option>
                <option value="vehicle">Vehicle</option>
                <option value="movable">Movable</option>
              </select>
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l">Acquisition cost (₹)</label>
              <input required type="number" min="0" step="0.01" value={form.acquisitionCost} onChange={(e) => setForm({ ...form, acquisitionCost: e.target.value })} style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l">Location</label>
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            </div>
          </div>
          <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 12 }}>{busy ? "Saving…" : "Register asset"}</button>
        </form>
      </div>
    </>
  );
}
