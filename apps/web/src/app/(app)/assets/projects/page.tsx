"use client";

import { useEffect, useState } from "react";

type Auc = {
  id: string;
  projectCode: string;
  name: string;
  accumulatedMinor: number | string;
  status: string;
  assetId?: string | null;
};

export default function ProjectsAucPage() {
  const [rows, setRows] = useState<Auc[]>([]);
  const [form, setForm] = useState({ projectCode: "", name: "", amountMinor: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/proxy/v1/asset/projects/auc");
    if (!res.ok) return;
    const body = await res.json() as { data: Auc[] };
    setRows(body.data ?? []);
  }

  useEffect(() => { void load(); }, []);

  async function createAuc(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/asset/projects/auc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectCode: form.projectCode,
          name: form.name,
          amountMinor: Math.round(Number(form.amountMinor || "0") * 100),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage("AUC project created.");
      setForm({ projectCode: "", name: "", amountMinor: "" });
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function capitalize(id: string) {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/asset/projects/auc/${id}/capitalize`, { method: "POST" });
      const body = await res.json().catch(() => ({})) as { id?: string };
      if (!res.ok) throw new Error(await res.text());
      setMessage(`Capitalized — asset ${body.id?.slice(0, 8) ?? ""}`);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Capitalize failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <a className="back" href="/assets">← Assets</a>
      <div className="ph" style={{ marginTop: 6 }}>
        <h1>Projects & AUC</h1>
        <div className="sub">Assets under construction — capitalize to fixed asset register with dual-book depreciation.</div>
      </div>
      {message ? <div className="banner" style={{ background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div> : null}
      <div className="card" style={{ marginBottom: 16 }}>
        <form onSubmit={createAuc} className="pad">
          <div className="fields">
            <input required placeholder="Project code" value={form.projectCode} onChange={(e) => setForm({ ...form, projectCode: e.target.value })} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            <input required placeholder="Project name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            <input placeholder="Accumulated cost (₹)" value={form.amountMinor} onChange={(e) => setForm({ ...form, amountMinor: e.target.value })} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
          </div>
          <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 12 }}>Create AUC</button>
        </form>
      </div>
      <div className="card">
        <div className="card-h"><h3>AUC register</h3></div>
        <div className="pad">
          {rows.length === 0 ? <p style={{ fontSize: 13, color: "var(--muted)" }}>No projects yet.</p> : (
            <table className="tbl">
              <thead><tr><th>Code</th><th>Name</th><th>Cost</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.projectCode}</td>
                    <td>{r.name}</td>
                    <td>₹{(Number(r.accumulatedMinor) / 100).toLocaleString("en-IN")}</td>
                    <td>{r.status}</td>
                    <td>{r.status === "under_construction" ? (
                      <button type="button" className="btn ghost" disabled={busy} onClick={() => void capitalize(r.id)}>Capitalize</button>
                    ) : r.assetId ? <a href={`/assets/${r.assetId}`}>View asset</a> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
