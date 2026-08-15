"use client";

import { useEffect, useState } from "react";
import { PageHeader, EmptyState } from "../../../_components/ds";

type Location = { id: string; code: string; name: string; orgUnit?: string | null };

export default function LocationsPage() {
  const [rows, setRows] = useState<Location[]>([]);
  const [form, setForm] = useState({ code: "", name: "", orgUnit: "" });
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function load(signal?: AbortSignal) {
    try {
      const res = await fetch("/api/proxy/v1/asset/locations", { signal });
      setLoaded(true);
      if (!res.ok) return;
      const body = await res.json() as { data: Location[] };
      setRows(body.data ?? []);
    } catch (e) {
      if (e instanceof Error && e.name !== 'AbortError') setLoaded(true);
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setIsError(false);
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
      setIsError(true);
      setMessage(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = { padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
  const fieldCol = { display: "flex", flexDirection: "column" as const, gap: 4 };

  return (
    <>
      <PageHeader
        title="Functional Locations"
        subtitle="Plant maintenance hierarchy — org units and equipment locations."
        back="/assets"
        backLabel="Assets"
      />
      {message ? (
        <div role="status" aria-live="polite" className="banner" style={{ background: "var(--panel)", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      <div className="card" style={{ marginBottom: 16 }}>
        <form onSubmit={submit} className="pad">
          <div className="fields">
            <div style={fieldCol}>
              <label className="l" htmlFor="loc-code">Location code</label>
              <input id="loc-code" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} style={inputStyle} />
            </div>
            <div style={fieldCol}>
              <label className="l" htmlFor="loc-name">Name</label>
              <input id="loc-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} />
            </div>
            <div style={fieldCol}>
              <label className="l" htmlFor="loc-org">Org unit</label>
              <input id="loc-org" value={form.orgUnit} onChange={(e) => setForm({ ...form, orgUnit: e.target.value })} style={inputStyle} />
            </div>
          </div>
          <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 12 }}>{busy ? "Adding…" : "Add location"}</button>
        </form>
      </div>
      <div className="card">
        <div className="card-h"><h3>Location tree</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="📍" title={loaded ? "No locations yet" : "Loading locations…"} message={loaded ? "Add functional locations to build the plant-maintenance hierarchy." : undefined} />
        ) : (
          <div className="pad">
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {rows.map((r) => (
                <li key={r.id}><strong>{r.code}</strong> — {r.name}{r.orgUnit ? ` (${r.orgUnit})` : ""}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
