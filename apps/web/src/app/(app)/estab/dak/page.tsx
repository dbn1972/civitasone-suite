"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PageHeader, StatusPill, DataTable, EmptyState } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";

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
  const [message, setMessage] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await fetch("/api/proxy/v1/estab/inward?limit=100", { signal });
      if (!res.ok) throw new Error(await res.text());
      const body = await res.json() as { data?: InwardRow[] };
      setRows(body.data ?? []);
    } catch (e) {
      if (e instanceof Error && e.name !== 'AbortError') {
        setMessage(e.message || "Load failed");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load]);

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

  const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)", minHeight: 44 } as const;

  return (
    <>
      <PageHeader
        title="DAK / Inward Registry"
        subtitle="Register incoming dak, link to digital files — NIC eOffice integrated flow."
        back="/estab/list"
      />

      <div role="alert" aria-live="polite">
        {message ? (
          <div className="banner" style={{ background: "#ecfdf3", border: "1px solid #6ee7b7", borderRadius: 12, padding: 12, marginBottom: 16, fontSize: 13 }}>
            {message}
          </div>
        ) : null}
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-h"><h3>Register new DAK</h3></div>
        <form onSubmit={registerDak} className="pad">
          <div className="fields">
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="dak-no">DAK number</label>
              <input id="dak-no" required value={form.dakNo} onChange={(e) => setForm({ ...form, dakNo: e.target.value })} style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="dak-from">From</label>
              <input id="dak-from" required value={form.fromAddress} onChange={(e) => setForm({ ...form, fromAddress: e.target.value })} style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="dak-subject">Subject</label>
              <input id="dak-subject" required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} style={inputStyle} />
            </div>
          </div>
          <button type="submit" className="btn primary" style={{ marginTop: 12 }}>Register DAK</button>
        </form>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Inward register</h3>
        </div>
        {loading ? (
          <p className="pad" style={{ textAlign: "center", color: "#94a3b8" }}>Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState icon="📥" title="No DAK registered yet" message="Register incoming dak above to start tracking it here." />
        ) : (
          <DataTable<InwardRow>
            columns={[
              { key: "dakNo", label: "DAK No", render: (r) => <span className="mono">{r.dakNo}</span> },
              { key: "barcode", label: "Barcode", render: (r) => <span className="mono" style={{ fontSize: 11 }}>{r.barcode ?? "—"}</span> },
              { key: "sourceSection", label: "Source", render: (r) => <>{r.sourceSection ?? "manual"}</> },
              { key: "fromAddress", label: "From" },
              { key: "subject", label: "Subject" },
              { key: "receivedAt", label: "Received", render: (r) => <>{formatIndianDate(r.receivedAt)}</> },
              { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} label={r.status.replace(/_/g, " ")} /> },
              {
                key: "fileId",
                label: "File",
                render: (r) =>
                  r.fileId ? (
                    <Link href={`/estab/files/${r.fileId}`} className="mono">{r.fileRef ?? r.fileId.slice(0, 8)}</Link>
                  ) : (
                    <>—</>
                  ),
              },
              {
                key: "id",
                label: "Action",
                sortable: false,
                render: (r) =>
                  !r.fileId && r.status === "received" ? (
                    <button type="button" className="btn ghost" style={{ fontSize: "0.75rem", minHeight: 44 }} onClick={() => void openFile(r.id)}>
                      Open file
                    </button>
                  ) : (
                    <>—</>
                  ),
              },
            ]}
            rows={rows}
            sortable
            filterable
            filterPlaceholder="Scan / search barcode or DAK no"
            pageSize={15}
          />
        )}
      </div>
    </>
  );
}
