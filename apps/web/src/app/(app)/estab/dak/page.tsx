"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PageHeader, StatusPill } from "../../../_components/ds";

type InwardRow = {
  id: string;
  dakNo: string;
  fromAddress: string;
  subject: string;
  receivedAt: string;
  status: string;
  fileId?: string | null;
  fileRef?: string | null;
  barcode?: string | null;
  sourceSection?: string | null;
};

const DEFAULT_OFFICER = "00000000-0000-0000-0000-000000000099";

export default function DakRegistryPage() {
  const router = useRouter();
  const [rows, setRows] = useState<InwardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ dakNo: "", fromAddress: "", subject: "" });
  const [scanBarcode, setScanBarcode] = useState("");
  const [message, setMessage] = useState("");

  const filteredRows = scanBarcode.trim()
    ? rows.filter((r) =>
        (r.barcode ?? "").toLowerCase().includes(scanBarcode.trim().toLowerCase())
        || r.dakNo.toLowerCase().includes(scanBarcode.trim().toLowerCase()),
      )
    : rows;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/proxy/v1/estab/inward?limit=100");
      if (!res.ok) throw new Error(await res.text());
      const body = await res.json() as { data?: InwardRow[] };
      setRows(body.data ?? []);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function registerDak(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/estab/inward", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, assignedTo: DEFAULT_OFFICER }),
      });
      if (!res.ok) throw new Error(await res.text());
      setForm({ dakNo: "", fromAddress: "", subject: "" });
      setMessage("DAK registered.");
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Register failed");
    }
  }

  async function openFile(inwardId: string) {
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/estab/inward/${inwardId}/open-file`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dept: "ADMIN",
          currentWith: DEFAULT_OFFICER,
          classification: "public",
        }),
      });
      const body = await res.json().catch(() => ({})) as { id?: string };
      if (!res.ok) throw new Error(await res.text());
      if (body.id) router.push(`/estab/files/${body.id}`);
      else {
        setMessage("File opening — refresh in a moment.");
        await load();
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Open file failed");
    }
  }

  return (
    <>
      <PageHeader
        title="DAK / Inward Registry"
        subtitle="Register incoming dak, link to digital files — NIC eOffice integrated flow."
        back="/estab/list"
      />

      {message ? (
        <div className="banner" style={{ background: "#ecfdf3", border: "1px solid #6ee7b7", borderRadius: 12, padding: 12, marginBottom: 16, fontSize: 13 }}>
          {message}
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-h"><h3>Register new DAK</h3></div>
        <form onSubmit={registerDak} className="pad">
          <div className="fields">
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l">DAK number</label>
              <input required value={form.dakNo} onChange={(e) => setForm({ ...form, dakNo: e.target.value })} style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l">From</label>
              <input required value={form.fromAddress} onChange={(e) => setForm({ ...form, fromAddress: e.target.value })} style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l">Subject</label>
              <input required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            </div>
          </div>
          <button type="submit" className="btn primary" style={{ marginTop: 12 }}>Register DAK</button>
        </form>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Inward register</h3>
          <input
            value={scanBarcode}
            onChange={(e) => setScanBarcode(e.target.value)}
            placeholder="Scan / search barcode or DAK no"
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 12, minWidth: 220 }}
          />
        </div>
        <table className="tbl">
          <thead>
            <tr><th>DAK No</th><th>Barcode</th><th>Source</th><th>From</th><th>Subject</th><th>Received</th><th>Status</th><th>File</th><th>Action</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ textAlign: "center", padding: 24 }}>Loading…</td></tr>
            ) : filteredRows.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: "center", padding: 24 }}>No DAK entries</td></tr>
            ) : (
              filteredRows.map((r) => (
                <tr key={r.id}>
                  <td><span className="mono">{r.dakNo}</span></td>
                  <td><span className="mono" style={{ fontSize: 11 }}>{r.barcode ?? "—"}</span></td>
                  <td>{r.sourceSection ?? "manual"}</td>
                  <td>{r.fromAddress}</td>
                  <td>{r.subject}</td>
                  <td>{r.receivedAt?.slice(0, 10) ?? "—"}</td>
                  <td><StatusPill status={r.status} label={r.status.replace(/_/g, " ")} /></td>
                  <td>
                    {r.fileId ? (
                      <Link href={`/estab/files/${r.fileId}`} className="mono">{r.fileRef ?? r.fileId.slice(0, 8)}</Link>
                    ) : "—"}
                  </td>
                  <td>
                    {!r.fileId && r.status === "received" ? (
                      <button type="button" className="btn ghost" style={{ fontSize: "0.75rem" }} onClick={() => void openFile(r.id)}>
                        Open file
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
