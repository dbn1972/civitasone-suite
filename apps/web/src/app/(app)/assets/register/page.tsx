"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "../../../_components/ds";

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
  const [isError, setIsError] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setIsError(false);
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
      setIsError(true);
      setMessage(e instanceof Error ? e.message : "Register failed");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;

  return (
    <>
      <PageHeader
        title="Register Asset"
        subtitle="Manual capitalization — Oracle/SAP-style asset master create."
        back="/assets/list"
        backLabel="Asset Register"
      />
      {message ? (
        <div role="status" aria-live="polite" className="banner" style={{ background: isError ? "#fef2f2" : "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      <div className="card">
        <form onSubmit={submit} className="pad">
          <div className="fields">
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="ast-name">Name</label>
              <input id="ast-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="ast-code">Asset code</label>
              <input id="ast-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="Auto-generated if blank" style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="ast-type">Type</label>
              <select id="ast-type" value={form.assetType} onChange={(e) => setForm({ ...form, assetType: e.target.value })} style={inputStyle}>
                <option value="fixed">Fixed</option>
                <option value="infra">Infrastructure</option>
                <option value="it">IT</option>
                <option value="vehicle">Vehicle</option>
                <option value="movable">Movable</option>
              </select>
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="ast-cost">Acquisition cost (₹)</label>
              <input id="ast-cost" required type="number" min="0" step="0.01" value={form.acquisitionCost} onChange={(e) => setForm({ ...form, acquisitionCost: e.target.value })} style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="ast-loc">Location</label>
              <input id="ast-loc" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} style={inputStyle} />
            </div>
          </div>
          <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 12 }}>{busy ? "Saving…" : "Register asset"}</button>
        </form>
      </div>
    </>
  );
}
