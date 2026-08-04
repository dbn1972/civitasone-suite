"use client";
/**
 * OwnershipDirectoryEditor — AS-002 admin. One tabbed screen to CRUD the four
 * ownership directories (queues, territories, partners, branches) that feed the
 * assignment engine. Each row is created (POST), updated (PUT) or deleted
 * (DELETE) individually per the contract; deletion is governed via a
 * ConfirmDialog. On a failed load we show the saved-info badge per tab and never
 * fabricate an empty directory as fact.
 */
import { useEffect, useId, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState, Tabs } from "../ds";
import {
  getResources,
  createResource,
  updateResource,
  deleteResource,
  OWNERSHIP_RESOURCES,
  OWNERSHIP_RESOURCE_LABELS,
  type OwnershipResource,
  type NamedResource,
  type AsSource,
} from "@/lib/crm/assignment";

interface Row extends NamedResource {
  key: string;
}
let SEQ = 0;
function toRow(r: NamedResource): Row {
  return { ...r, key: r.id ?? `new-${SEQ++}` };
}

const inputStyle = { padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)", width: "100%" } as const;
const TAB_LABELS = OWNERSHIP_RESOURCES.map((r) => OWNERSHIP_RESOURCE_LABELS[r]);
const labelToResource = (label: string): OwnershipResource =>
  OWNERSHIP_RESOURCES.find((r) => OWNERSHIP_RESOURCE_LABELS[r] === label) ?? OWNERSHIP_RESOURCES[0];

function ResourceTable({ resource }: { resource: OwnershipResource }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [source, setSource] = useState<AsSource | "loading">("loading");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const headingId = useId();

  async function load(isLive: () => boolean = () => true) {
    setSource("loading");
    const { data, source: s } = await getResources(resource);
    if (!isLive()) return;
    setRows(data.map(toRow));
    setSource(s);
  }

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => { live = false; };
  }, [resource]);

  function update(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, toRow({ name: "", description: "", enabled: true })]);
  }

  async function saveRow(row: Row) {
    setMessage("");
    setError("");
    if (!row.name.trim()) {
      setError("Every entry needs a name before it can be saved.");
      return;
    }
    const body: NamedResource = {
      ...(row.id ? { id: row.id } : {}),
      name: row.name.trim(),
      description: row.description.trim(),
      enabled: row.enabled,
    };
    setBusyKey(row.key);
    try {
      if (row.id) await updateResource(resource, row.id, body);
      else await createResource(resource, body);
      setMessage(`“${body.name}” saved.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the entry.");
    } finally {
      setBusyKey(null);
    }
  }

  async function confirmDelete(row: Row) {
    if (!row.id) {
      setRows((prev) => prev.filter((r) => r.key !== row.key));
      setConfirmKey(null);
      return;
    }
    setBusyKey(row.key);
    setError("");
    try {
      await deleteResource(resource, row.id);
      setMessage(`“${row.name}” deleted.`);
      setConfirmKey(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the entry.");
    } finally {
      setBusyKey(null);
    }
  }

  const label = OWNERSHIP_RESOURCE_LABELS[resource];
  const confirmRow = rows.find((r) => r.key === confirmKey) ?? null;

  if (source === "loading") {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", padding: 12 }}>
        Loading {label.toLowerCase()}…
      </p>
    );
  }

  return (
    <div>
      <div className="card-h">
        <h3 id={headingId}>{label}</h3>
        {source === "error" ? <DataSourceBadge source="error" /> : null}
      </div>
      {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", padding: "0 12px" }}>{message}</p> : null}
      {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", padding: "0 12px" }}>{error}</p> : null}

      {rows.length === 0 ? (
        <EmptyState icon="🗂️" title={`No ${label.toLowerCase()} yet`} message={`Add ${label.toLowerCase()} used to route and own leads.`} />
      ) : (
        <table className="tbl" aria-labelledby={headingId}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Description</th>
              <th>Enabled</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const n = i + 1;
              const busy = busyKey === row.key;
              return (
                <tr key={row.key}>
                  <td>
                    <label className="sr-only" htmlFor={`${headingId}-name-${row.key}`}>Name for entry {n}</label>
                    <input
                      id={`${headingId}-name-${row.key}`}
                      value={row.name}
                      aria-invalid={row.name.trim() ? undefined : true}
                      onChange={(e) => update(row.key, { name: e.target.value })}
                      placeholder={`${label.replace(/s$/, "")} name`}
                      style={inputStyle}
                    />
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`${headingId}-desc-${row.key}`}>Description for entry {n}</label>
                    <input id={`${headingId}-desc-${row.key}`} value={row.description} onChange={(e) => update(row.key, { description: e.target.value })} placeholder="Optional description" style={inputStyle} />
                  </td>
                  <td>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      <input type="checkbox" checked={row.enabled} onChange={(e) => update(row.key, { enabled: e.target.checked })} aria-label={`Enable entry ${n}`} />
                      {row.enabled ? "On" : "Off"}
                    </label>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button type="button" className="btn primary sm" onClick={() => void saveRow(row)} disabled={busy}>
                        {busy ? "…" : row.id ? "Save" : "Create"}
                      </button>
                      <button type="button" className="btn ghost sm" onClick={() => setConfirmKey(row.key)} disabled={busy} aria-label={`Delete entry ${n}`}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div style={{ display: "flex", gap: 8, padding: 12 }}>
        <button type="button" className="btn ghost" onClick={addRow}>+ Add {label.replace(/s$/, "").toLowerCase()}</button>
      </div>

      <ConfirmDialog
        open={confirmRow !== null}
        danger
        title={confirmRow ? `Delete “${confirmRow.name || "(unnamed)"}”?` : ""}
        description="This entry will no longer be available for assignment. This cannot be undone."
        confirmLabel="Delete"
        busy={confirmRow ? busyKey === confirmRow.key : false}
        onCancel={() => setConfirmKey(null)}
        onConfirm={() => confirmRow && void confirmDelete(confirmRow)}
      />
    </div>
  );
}

export function OwnershipDirectoryEditor() {
  const [active, setActive] = useState(TAB_LABELS[0]);
  const resource = labelToResource(active);
  return (
    <div className="card">
      <Tabs tabs={TAB_LABELS} active={active} onChange={setActive} />
      {/* Remount per resource so each tab loads its own directory cleanly. */}
      <ResourceTable key={resource} resource={resource} />
    </div>
  );
}
