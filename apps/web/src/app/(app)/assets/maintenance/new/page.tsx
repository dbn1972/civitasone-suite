"use client";

/**
 * Log Maintenance Job (work order).
 * POSTs to the real asset-service endpoint POST /v1/assets/work-orders
 * (body: { assetId: uuid, scheduledDate: "YYYY-MM-DD", notes? }) via the gateway
 * proxy (/api/proxy/v1/asset/...). Assets are loaded from GET /v1/asset/assets.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "../../../../_components/ds";

type AssetRow = { id: string; code?: string; name?: string };

const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;

export default function NewWorkOrderPage() {
  const router = useRouter();
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loadError, setLoadError] = useState("");
  const [assetId, setAssetId] = useState("");
  const [scheduledDate, setScheduledDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/proxy/v1/asset/assets?limit=200", { headers: { accept: "application/json" } });
        if (!res.ok) throw new Error(`Failed to load assets (${res.status}).`);
        const json = (await res.json()) as { data?: AssetRow[] } | AssetRow[];
        if (active) setAssets(Array.isArray(json) ? json : json.data ?? []);
      } catch (e) {
        if (active) setLoadError(e instanceof Error ? e.message : "Failed to load assets.");
      }
    })();
    return () => { active = false; };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setIsError(false);
    try {
      const res = await fetch("/api/proxy/v1/asset/work-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetId, scheduledDate, notes: notes || undefined }),
      });
      if (!(res.ok || res.status === 202)) throw new Error(await res.text());
      setMessage("Maintenance job logged.");
      setNotes("");
      router.refresh();
      setTimeout(() => router.push("/assets/maintenance"), 700);
    } catch (e) {
      setIsError(true);
      setMessage(e instanceof Error ? e.message : "Submit failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Log Maintenance Job"
        subtitle="Raise a work order against an asset."
        back="/assets/maintenance"
        backLabel="Asset Maintenance"
      />
      {message ? (
        <div role={isError ? "alert" : "status"} aria-live={isError ? "assertive" : "polite"} className="banner" style={{ background: isError ? "#fef2f2" : "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      {loadError ? (
        <div role="alert" aria-live="assertive" className="banner" style={{ background: "#fef2f2", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{loadError}</div>
      ) : null}
      <div className="card">
        <form onSubmit={submit} className="pad">
          <div className="fields">
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="wo-asset">Asset</label>
              <select id="wo-asset" required value={assetId} onChange={(e) => setAssetId(e.target.value)} style={inputStyle}>
                <option value="" disabled>Select an asset…</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>{[a.code, a.name].filter(Boolean).join(" · ") || a.id}</option>
                ))}
              </select>
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="wo-date">Scheduled date</label>
              <input id="wo-date" required type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="wo-notes">Notes</label>
              <input id="wo-notes" value={notes} onChange={(e) => setNotes(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <button type="submit" className="btn primary" disabled={busy || !assetId} aria-busy={busy} style={{ marginTop: 12 }}>
            {busy ? "Saving…" : "Log job"}
          </button>
        </form>
      </div>
    </>
  );
}
