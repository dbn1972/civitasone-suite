"use client";

import { useEffect, useState } from "react";
import { PageHeader, DataTable, EmptyState, ConfirmDialog, useConfirmAction } from "../../../_components/ds";
import { formatMoney } from "@/lib/formatters";

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
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [target, setTarget] = useState<Auc | null>(null);

  async function load() {
    const res = await fetch("/api/proxy/v1/asset/projects/auc");
    setLoaded(true);
    if (!res.ok) return;
    const body = await res.json() as { data: Auc[] };
    setRows(body.data ?? []);
  }

  useEffect(() => { void load(); }, []);

  async function createAuc(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setIsError(false);
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
      setIsError(true);
      setMessage(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  const capitalizeAction = useConfirmAction({
    onConfirm: async (reason) => {
      if (!target) return;
      const res = await fetch(`/api/proxy/v1/asset/projects/auc/${target.id}/capitalize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = await res.json().catch(() => ({})) as { id?: string };
      if (!res.ok) throw new Error(await res.text());
      setIsError(false);
      setMessage(`Capitalized — asset ${body.id?.slice(0, 8) ?? ""}`);
      setTarget(null);
      await load();
    },
  });

  const inputStyle = { padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
  const fieldCol = { display: "flex", flexDirection: "column" as const, gap: 4 };

  const tableRows = rows.map((r) => ({
    id: r.id,
    projectCode: r.projectCode,
    name: r.name,
    cost: formatMoney(r.accumulatedMinor),
    status: r.status.replace(/_/g, " "),
    _raw: r,
  }));

  return (
    <>
      <PageHeader
        title="Projects & AUC"
        subtitle="Assets under construction — capitalize to fixed asset register with dual-book depreciation."
        back="/assets"
        backLabel="Assets"
      />
      {message ? (
        <div role="status" aria-live="polite" className="banner" style={{ background: isError ? "#fef2f2" : "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      <div className="card" style={{ marginBottom: 16 }}>
        <form onSubmit={createAuc} className="pad">
          <div className="fields">
            <div style={fieldCol}>
              <label className="l" htmlFor="auc-code">Project code</label>
              <input id="auc-code" required value={form.projectCode} onChange={(e) => setForm({ ...form, projectCode: e.target.value })} style={inputStyle} />
            </div>
            <div style={fieldCol}>
              <label className="l" htmlFor="auc-name">Project name</label>
              <input id="auc-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} />
            </div>
            <div style={fieldCol}>
              <label className="l" htmlFor="auc-amt">Accumulated cost (₹)</label>
              <input id="auc-amt" inputMode="decimal" value={form.amountMinor} onChange={(e) => setForm({ ...form, amountMinor: e.target.value })} style={inputStyle} />
            </div>
          </div>
          <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 12 }}>{busy ? "Creating…" : "Create AUC"}</button>
        </form>
      </div>
      <div className="card">
        <div className="card-h"><h3>AUC register</h3></div>
        {tableRows.length === 0 ? (
          <EmptyState icon="🏗️" title={loaded ? "No projects yet" : "Loading projects…"} message={loaded ? "Create an AUC project to accumulate WIP before capitalization." : undefined} />
        ) : (
          <DataTable
            columns={[
              { key: "projectCode", label: "Code" },
              { key: "name", label: "Name" },
              { key: "cost", label: "Cost", align: "right" },
              { key: "status", label: "Status", cellType: "status" },
              {
                key: "id",
                label: "",
                render: (r) =>
                  r._raw.status === "under_construction" ? (
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => {
                        setTarget(r._raw);
                        capitalizeAction.trigger();
                      }}
                    >
                      Capitalize
                    </button>
                  ) : r._raw.assetId ? (
                    <a href={`/assets/${r._raw.assetId}`}>View asset</a>
                  ) : null,
              },
            ]}
            rows={tableRows}
            sortable
          />
        )}
      </div>

      <ConfirmDialog
        open={capitalizeAction.open}
        title="Capitalize this project?"
        description={<>This transfers <b>{target ? formatMoney(target.accumulatedMinor) : ""}</b> of accumulated WIP from AUC into the fixed-asset register and starts dual-book depreciation. This posts to the GL and cannot be undone.</>}
        confirmLabel="Capitalize to fixed asset"
        requireReason
        reasonLabel="Reason / authorisation"
        busy={capitalizeAction.busy}
        errorMessage={capitalizeAction.error}
        onConfirm={capitalizeAction.confirm}
        onCancel={() => {
          capitalizeAction.cancel();
          setTarget(null);
        }}
      />
    </>
  );
}
