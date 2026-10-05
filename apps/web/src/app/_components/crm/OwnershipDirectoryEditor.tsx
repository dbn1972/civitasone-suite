"use client";
/**
 * OwnershipDirectoryEditor — AS-002 admin. One tabbed screen to CRUD the four
 * ownership directories (queues, territories, partners, branches) that feed the
 * assignment engine. Each row is created (POST), updated (PUT) or deleted
 * (DELETE) individually per the contract; deletion is governed via a
 * ConfirmDialog. On a failed load we show a retry (not a false empty directory
 * with an enabled "+ Add", which could duplicate routing entries).
 */
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { ConfirmDialog, EmptyState, Tabs, Button } from "../ds";
import { ErrorState } from "../ds/ErrorState";
import { toHumanError } from "@/lib/messages";
import {
  getResources,
  createResource,
  updateResource,
  deleteResource,
  OWNERSHIP_RESOURCES,
  OWNERSHIP_RESOURCE_LABELS,
  OWNERSHIP_RESOURCE_SINGULAR,
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
  const t = useTranslations("crmOwnershipDirectoryEditor");
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load is redefined each render but only closes over values already listed in this array; nothing else it reads can change independently.
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
      // GAP-CRM-ASSIGNMENT-DIRECTORY-03: re-send the unmodelled, type-specific
      // fields verbatim so an edit never drops them (lossless round-trip).
      ...(row.extra ? row.extra : {}),
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
  const singular = OWNERSHIP_RESOURCE_SINGULAR[resource];
  const confirmRow = rows.find((r) => r.key === confirmKey) ?? null;

  if (source === "loading") {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", padding: 12 }}>
        Loading {label.toLowerCase()}…
      </p>
    );
  }

  // GAP-CRM-ASSIGNMENT-DIRECTORY-02: on a failed load the rows are [], which
  // must NOT read as "No queues yet" with an enabled "+ Add" button (an admin
  // could re-create entries that already exist and duplicate routing data).
  // Show a retry and offer no create/edit controls until the load succeeds.
  if (source === "error") {
    return (
      <div>
        <div className="card-h"><h3 id={headingId}>{label}</h3></div>
        <ErrorState
          error={toHumanError("load", { area: label.toLowerCase() })}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="card-h">
        <h3 id={headingId}>{label}</h3>
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
                      placeholder={t("namePlaceholder", { singular })}
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
                      <Button type="button" size="sm" onClick={() => void saveRow(row)} disabled={busy}>
                        {busy ? "…" : row.id ? "Save" : "Create"}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmKey(row.key)} disabled={busy} aria-label={`Delete entry ${n}`}>
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div style={{ display: "flex", gap: 8, padding: 12 }}>
        <Button type="button" variant="ghost" onClick={addRow}>{t("addSingular", { singular: singular.toLowerCase() })}</Button>
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
