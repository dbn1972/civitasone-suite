"use client";

import { useEffect, useState } from "react";

type Location = { id: string; code: string; name: string; orgUnit?: string | null };

export default function LocationsPage() {
  const [rows, setRows] = useState<Location[]>([]);
  const [form, setForm] = useState({ code: "", name: "", orgUnit: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/proxy/v1/asset/locations");
    if (!res.ok) return;
    const body = await res.json() as { data: Location[] };
    setRows(body.data ?? []);
  }

  useEffect(() => { void load(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/asset/locations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: form.code,
          name: form.name,
          orgUnit: form.orgUnit || undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage("Functional location created.");
      setForm({ code: "", name: "", orgUnit: "" });
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <a className="back" href="/assets">← Assets</a>
      <div className="ph" style={{ marginTop: 6 }}>
        <h1>Functional Locations</h1>
        <div className="sub">Plant maintenance hierarchy — org units and equipment locations.</div>
      </div>
      {message ? <div className="banner" style={{ background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div> : null}
      <div className="card" style={{ marginBottom: 16 }}>
        <form onSubmit={submit} className="pad">
          <div className="fields">
            <input required placeholder="Location code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            <input required placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            <input placeholder="Org unit" value={form.orgUnit} onChange={(e) => setForm({ ...form, orgUnit: e.target.value })} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
          </div>
          <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 12 }}>Add location</button>
        </form>
      </div>
      <div className="card">
        <div className="card-h"><h3>Location tree</h3></div>
        <div className="pad">
          {rows.length === 0 ? <p style={{ fontSize: 13, color: "var(--muted)" }}>No locations yet.</p> : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {rows.map((r) => (
                <li key={r.id}><strong>{r.code}</strong> — {r.name}{r.orgUnit ? ` (${r.orgUnit})` : ""}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
