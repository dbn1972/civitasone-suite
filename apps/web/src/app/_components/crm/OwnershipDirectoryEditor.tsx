"use client";
/**
 * OwnershipDirectoryEditor — AS-002 admin. One tabbed screen to CRUD the four
 * ownership directories (queues, territories, partners, branches) that feed the
 * assignment engine. Each row is created (POST), updated (PUT) or deleted
 * (DELETE) individually per the contract; deletion is governed via a
 * ConfirmDialog. On a failed load we show a retry (not a false empty directory
 * with an enabled "+ Add", which could duplicate routing entries).
 *
 * - GAP-CRM-ASSIGNMENT-DIRECTORY-06: each row keeps a `saved` snapshot so the
 *   UI can mark unsaved rows ("Unsaved"), disable Save when a row is unchanged,
 *   and — after a save — update ONLY that row from server data instead of
 *   calling load() for the whole table (which discarded unsaved edits on other
 *   rows).
 * - GAP-CRM-ASSIGNMENT-DIRECTORY-05: switching tabs with unsaved edits opens a
 *   ConfirmDialog before discarding them (ResourceTable reports dirty state up
 *   via onDirtyChange), and a beforeunload guard warns on a full navigation.
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
  /** Last loaded/saved server values; absent for an unsaved new row. */
  saved?: NamedResource;
}
let SEQ = 0;
function toRow(r: NamedResource): Row {
  return { ...r, key: r.id ?? `new-${SEQ++}`, saved: r };
}

/** A row differs from its last-saved snapshot (new rows are always dirty). */
function isRowDirty(row: Row): boolean {
  if (!row.saved) return true;
  return (
    row.name !== row.saved.name ||
    row.description !== row.saved.description ||
    row.enabled !== row.saved.enabled
  );
}

const inputStyle = { padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)", width: "100%" } as const;
const TAB_LABELS = OWNERSHIP_RESOURCES.map((r) => OWNERSHIP_RESOURCE_LABELS[r]);
const labelToResource = (label: string): OwnershipResource =>
  OWNERSHIP_RESOURCES.find((r) => OWNERSHIP_RESOURCE_LABELS[r] === label) ?? OWNERSHIP_RESOURCES[0];

function ResourceTable({
  resource,
  onDirtyChange,
}: {
  resource: OwnershipResource;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const t = useTranslations("crmOwnershipDirectoryEditor");
  const [rows, setRows] = useState<Row[]>([]);
  const [source, setSource] = useState<AsSource | "loading">("loading");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const headingId = useId();

  // Report the table's dirty state to the parent (for the tab-switch guard).
  const anyDirty = rows.some(isRowDirty);
  useEffect(() => {
    onDirtyChange?.(anyDirty);
  }, [anyDirty, onDirtyChange]);

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
    setRows((prev) => [...prev, { name: "", description: "", enabled: true, key: `new-${SEQ++}` }]);
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
      // GAP-CRM-ASSIGNMENT-DIRECTORY-06: update ONLY this row's snapshot (and
      // mark it clean) instead of load()-ing the whole table and discarding
      // other rows' unsaved edits. For a brand-new row we re-fetch to pick up
      // the server-assigned id but merge it onto this row alone.
      if (row.id) {
        setRows((prev) =>
          prev.map((r) => (r.key === row.key ? { ...r, ...body, saved: { ...body } } : r)),
        );
      } else {
        const { data, source: s } = await getResources(resource);
        if (s === "api") {
          const created = data.find((d) => d.name === body.name && !rows.some((r) => r.id === d.id));
          if (created) {
            setRows((prev) =>
              prev.map((r) => (r.key === row.key ? { ...toRow(created) } : r)),
            );
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the entry.");
    } finally {
      setBusyKey(null);
    }
  }

  /** GAP-CRM-ASSIGNMENT-DIRECTORY-06: revert a row to its saved snapshot. */
  function discardRow(row: Row) {
    if (!row.saved) {
      // Unsaved new row — drop it entirely.
      setRows((prev) => prev.filter((r) => r.key !== row.key));
      return;
    }
    setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, ...row.saved!, saved: row.saved } : r)));
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
      setRows((prev) => prev.filter((r) => r.key !== row.key));
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
            {rows.map((row) => {
              const busy = busyKey === row.key;
              const dirty = isRowDirty(row);
              // GAP-CRM-AGENT-WORKLOAD-06 (sibling fix): label by the row's own
              // name when it has one, so a screen-reader user is not told a bare
              // position. Fall back to the singular noun for a blank new row.
              const rowName = row.name.trim() || `new ${singular.toLowerCase()}`;
              return (
                <tr key={row.key} data-dirty={dirty ? "true" : undefined}>
                  <td>
                    <label className="sr-only" htmlFor={`${headingId}-name-${row.key}`}>Name for {rowName}</label>
                    <input
                      id={`${headingId}-name-${row.key}`}
                      value={row.name}
                      aria-invalid={row.name.trim() ? undefined : true}
                      onChange={(e) => update(row.key, { name: e.target.value })}
                      placeholder={t("namePlaceholder", { singular })}
                      style={inputStyle}
                    />
                    {dirty ? (
                      <span className="pill warn" style={{ display: "inline-block", marginTop: 4, fontSize: 11 }}>Unsaved</span>
                    ) : null}
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`${headingId}-desc-${row.key}`}>Description for {rowName}</label>
                    <input id={`${headingId}-desc-${row.key}`} value={row.description} onChange={(e) => update(row.key, { description: e.target.value })} placeholder="Optional description" style={inputStyle} />
                  </td>
                  <td>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      <input type="checkbox" checked={row.enabled} onChange={(e) => update(row.key, { enabled: e.target.checked })} aria-label={`Enable ${rowName}`} />
                      {row.enabled ? "On" : "Off"}
                    </label>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Button type="button" size="sm" onClick={() => void saveRow(row)} disabled={busy || !dirty} aria-label={row.id ? `Save ${rowName}` : `Create ${rowName}`}>
                        {busy ? "…" : row.id ? "Save" : "Create"}
                      </Button>
                      {dirty ? (
                        <Button type="button" variant="ghost" size="sm" onClick={() => discardRow(row)} disabled={busy} aria-label={`Discard changes to ${rowName}`}>
                          Discard
                        </Button>
                      ) : null}
                      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmKey(row.key)} disabled={busy} aria-label={`Delete ${rowName}`}>
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
  const [dirty, setDirty] = useState(false);
  // The tab the admin is trying to switch to while the current one is dirty.
  const [pendingTab, setPendingTab] = useState<string | null>(null);
  const resource = labelToResource(active);

  // GAP-CRM-ASSIGNMENT-DIRECTORY-05: warn before a full-page navigation while
  // there are unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function requestTab(tab: string) {
    if (tab === active) return;
    if (dirty) {
      // Intercept: keep the current tab until the admin confirms discarding.
      setPendingTab(tab);
      return;
    }
    setActive(tab);
  }

  return (
    <div className="card">
      <Tabs tabs={TAB_LABELS} active={active} onChange={requestTab} />
      {/* Remount per resource so each tab loads its own directory cleanly. */}
      <ResourceTable key={resource} resource={resource} onDirtyChange={setDirty} />

      <ConfirmDialog
        open={pendingTab !== null}
        danger
        title="Discard unsaved changes?"
        description="You have unsaved edits on this tab. Switching tabs will discard them."
        confirmLabel="Discard and switch"
        cancelLabel="Stay on this tab"
        onCancel={() => setPendingTab(null)}
        onConfirm={() => {
          const next = pendingTab;
          setPendingTab(null);
          setDirty(false);
          if (next) setActive(next);
        }}
      />
    </div>
  );
}
