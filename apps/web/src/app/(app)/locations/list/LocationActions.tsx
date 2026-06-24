"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Row = { id: string; label: string; status?: string };

export function LocationActions({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState("office");
  const [lgdCode, setLgdCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/locations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, type, lgdCode: lgdCode || undefined }),
      });
      if (!res.ok) throw new Error(await res.text());
      setName("");
      setLgdCode("");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function archive(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/v1/locations/${id}/archive`, { method: "PATCH" });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid g-2" style={{ marginBottom: 18 }}>
      <div className="card">
        <div className="card-h"><h3>Create Location</h3></div>
        <form className="pad" onSubmit={create}>
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Location name" style={{ width: "100%", padding: 8, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
          <select value={type} onChange={(e) => setType(e.target.value)} style={{ width: "100%", padding: 8, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" }}>
            <option value="state">State</option>
            <option value="district">District</option>
            <option value="block">Block</option>
            <option value="ward">Ward</option>
            <option value="office">Office</option>
            <option value="facility">Facility</option>
          </select>
          <input value={lgdCode} onChange={(e) => setLgdCode(e.target.value)} placeholder="LGD code (optional)" style={{ width: "100%", padding: 8, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
          <button className="btn primary" disabled={busy}>{busy ? "Saving..." : "Add location"}</button>
        </form>
        {message ? <p style={{ color: "#b91c1c", padding: "0 16px 16px", fontSize: 12 }}>{message}</p> : null}
      </div>
      <div className="card">
        <div className="card-h"><h3>Operational Controls</h3></div>
        <div className="pad">
          {rows.filter((r) => r.status !== "archived").slice(0, 8).map((row) => (
            <div key={row.id} className="prefrow">
              <span>{row.label}</span>
              <button className="btn ghost" disabled={busy} onClick={() => void archive(row.id)}>Archive</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
