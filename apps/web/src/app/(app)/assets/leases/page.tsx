"use client";

import { useEffect, useState } from "react";
import { PageHeader, DataTable, EmptyState } from "../../../_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";

type Lease = {
  id: string;
  leaseNo: string;
  lessorName: string;
  rouCostMinor: number | string;
  liabilityMinor: number | string;
  leaseStart: string;
  leaseEnd: string;
  assetId?: string | null;
  status: string;
};

export default function LeasesPage() {
  const [rows, setRows] = useState<Lease[]>([]);
  const [form, setForm] = useState({ leaseNo: "", lessorName: "", rouCost: "", liability: "", leaseStart: "", leaseEnd: "" });
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    const res = await fetch("/api/proxy/v1/asset/leases");
    setLoaded(true);
    if (!res.ok) return;
    const body = await res.json() as { data: Lease[] };
    setRows(body.data ?? []);
  }

  useEffect(() => { void load(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setIsError(false);
    try {
      const res = await fetch("/api/proxy/v1/asset/leases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leaseNo: form.leaseNo,
          lessorName: form.lessorName,
          rouCostMinor: Math.round(Number(form.rouCost || "0") * 100),
          liabilityMinor: Math.round(Number(form.liability || "0") * 100),
          leaseStart: form.leaseStart,
          leaseEnd: form.leaseEnd,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage("IFRS 16 lease registered with ROU asset.");
      setForm({ leaseNo: "", lessorName: "", rouCost: "", liability: "", leaseStart: "", leaseEnd: "" });
      await load();
    } catch (e) {
      setIsError(true);
      setMessage(e instanceof Error ? e.message : "Register failed");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = { padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
  const fieldCol = { display: "flex", flexDirection: "column" as const, gap: 4 };

  const tableRows = rows.map((r) => ({
    id: r.id,
    leaseNo: r.leaseNo,
    lessorName: r.lessorName,
    rou: formatMoney(r.rouCostMinor),
    term: `${formatIndianDate(r.leaseStart)} → ${formatIndianDate(r.leaseEnd)}`,
    asset: r.assetId ? "View" : "—",
    assetId: r.assetId ?? "",
  }));

  return (
    <>
      <PageHeader
        title="IFRS 16 Leases"
        subtitle="Right-of-use assets and lease liability tracking."
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
              <label className="l" htmlFor="lease-no">Lease no.</label>
              <input id="lease-no" required value={form.leaseNo} onChange={(e) => setForm({ ...form, leaseNo: e.target.value })} style={inputStyle} />
            </div>
            <div style={fieldCol}>
              <label className="l" htmlFor="lease-lessor">Lessor</label>
              <input id="lease-lessor" required value={form.lessorName} onChange={(e) => setForm({ ...form, lessorName: e.target.value })} style={inputStyle} />
            </div>
            <div style={fieldCol}>
              <label className="l" htmlFor="lease-rou">ROU cost (₹)</label>
              <input id="lease-rou" required inputMode="decimal" value={form.rouCost} onChange={(e) => setForm({ ...form, rouCost: e.target.value })} style={inputStyle} />
            </div>
            <div style={fieldCol}>
              <label className="l" htmlFor="lease-liab">Liability (₹)</label>
              <input id="lease-liab" required inputMode="decimal" value={form.liability} onChange={(e) => setForm({ ...form, liability: e.target.value })} style={inputStyle} />
            </div>
            <div style={fieldCol}>
              <label className="l" htmlFor="lease-start">Lease start</label>
              <input id="lease-start" required type="date" value={form.leaseStart} onChange={(e) => setForm({ ...form, leaseStart: e.target.value })} style={inputStyle} />
            </div>
            <div style={fieldCol}>
              <label className="l" htmlFor="lease-end">Lease end</label>
              <input id="lease-end" required type="date" value={form.leaseEnd} onChange={(e) => setForm({ ...form, leaseEnd: e.target.value })} style={inputStyle} />
            </div>
          </div>
          <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 12 }}>{busy ? "Registering…" : "Register lease"}</button>
        </form>
      </div>
      <div className="card">
        <div className="card-h"><h3>Active leases</h3></div>
        {tableRows.length === 0 ? (
          <EmptyState icon="📄" title={loaded ? "No leases yet" : "Loading leases…"} message={loaded ? "Register an IFRS 16 lease to track ROU assets and liabilities." : undefined} />
        ) : (
          <DataTable
            columns={[
              { key: "leaseNo", label: "Lease" },
              { key: "lessorName", label: "Lessor" },
              { key: "rou", label: "ROU", align: "right" },
              { key: "term", label: "Term" },
              { key: "asset", label: "Asset", render: (r) => (r.assetId ? <a href={`/assets/${r.assetId}`}>View</a> : "—") },
            ]}
            rows={tableRows}
            sortable
          />
        )}
      </div>
    </>
  );
}
