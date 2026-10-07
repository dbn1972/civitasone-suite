"use client";

import { useState } from "react";
import { Button, ConfirmDialog, DataTable, Modal, PageHeader, RefreshErrorState, StatGrid, StatCard, useToast } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import type { AdminFeatureFlagRow } from "@/app/_data/loaders";
import { useFormError } from "@/lib/useFormError";
import { toHumanError } from "@/lib/messages";
import { parseSegments, validateFlagForm } from "./flagForm";

function getStatusBadge(flag: AdminFeatureFlagRow) {
  if (flag.killSwitch) return <span className="pill bad">Killed</span>;
  if (!flag.enabled) return <span className="pill mut">Disabled</span>;
  if (flag.rolloutPercent === 100) return <span className="pill good">Active</span>;
  return <span className="pill warn">Partial ({flag.rolloutPercent}%)</span>;
}

/** Sortable status text for the Status column. */
function statusText(flag: AdminFeatureFlagRow): string {
  if (flag.killSwitch) return "Killed";
  if (!flag.enabled) return "Disabled";
  return flag.rolloutPercent === 100 ? "Active" : `Partial (${flag.rolloutPercent}%)`;
}

type FlagTableRow = AdminFeatureFlagRow & { status: string; actions: string };

/**
 * Plain-language failure message for a failed flag toggle/kill-switch call.
 * This is a plain async API helper, not a component, so it can't use the
 * useFormError hook; toHumanError is the same catalogued-message building
 * block that hook is built on — never the backend's own `message` or the
 * raw HTTP status. See docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-003/UX-016.
 */
function featureFlagError(): string {
  const human = toHumanError("save", { area: "feature flag" });
  return `${human.what} ${human.next}`;
}

async function callApi(path: string, method: string, body?: unknown): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(`/api/proxy/v1/admin/feature-flags/manage${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return { ok: false, message: featureFlagError() };
    return { ok: true };
  } catch {
    return { ok: false, message: featureFlagError() };
  }
}

type PendingEdit = { flag: AdminFeatureFlagRow; patch: Record<string, unknown> };

export function FeatureFlagsManager({ initialFlags, source }: { initialFlags: AdminFeatureFlagRow[]; source: "api" | "error" }) {
  const [flags, setFlags] = useState<AdminFeatureFlagRow[]>(initialFlags);
  // null = closed, "create" = new flag, otherwise the flag being edited.
  const [dialog, setDialog] = useState<null | "create" | AdminFeatureFlagRow>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // GAP-ADMIN-FEATURE-FLAGS-01: Kill only opens a confirmation; nothing is
  // sent until the operator confirms with a reason.
  const [killTarget, setKillTarget] = useState<AdminFeatureFlagRow | null>(null);
  const [killError, setKillError] = useState<string | undefined>(undefined);
  // GAP-ADMIN-FEATURE-FLAGS-04: a rollout INCREASE changes live traffic -> explicit confirm.
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const [pendingError, setPendingError] = useState<string | undefined>(undefined);
  // Enabling/disabling changes live behaviour for everyone the flag targets -> confirm first.
  const [toggleTarget, setToggleTarget] = useState<AdminFeatureFlagRow | null>(null);
  const formError = useFormError("feature flag");
  const { toast } = useToast();

  // GAP-ADMIN-FEATURE-FLAGS-03: a failed load must not read as an empty registry.
  if (source === "error" && initialFlags.length === 0) {
    return (
      <div className="page-main wrap">
        <PageHeader title="Feature Flags" subtitle="Platform feature toggles with gradual rollout controls and kill switch." back="/admin" />
        <RefreshErrorState error={toHumanError("load", { area: "feature flags" })} backHref="/admin" />
      </div>
    );
  }

  const activeCount = flags.filter((f) => f.enabled && f.rolloutPercent === 100 && !f.killSwitch).length;
  const partialCount = flags.filter((f) => f.enabled && f.rolloutPercent > 0 && f.rolloutPercent < 100 && !f.killSwitch).length;
  const killedCount = flags.filter((f) => f.killSwitch).length;

  async function refresh() {
    try {
      const res = await fetch("/api/proxy/v1/admin/feature-flags/manage", { cache: "no-store" });
      if (!res.ok) throw new Error("refresh failed");
      const body = (await res.json()) as { data?: AdminFeatureFlagRow[] };
      if (Array.isArray(body.data)) setFlags(body.data);
    } catch {
      // The mutation itself succeeded, but the list on screen may be stale: say so
      // rather than silently showing old rows (GAP-ADMIN-FEATURE-FLAGS-03).
      const human = toHumanError("load", { area: "the updated feature flags" });
      setError(`${human.what} ${human.next}`);
    }
  }

  async function handleKillSwitch(id: string, reason: string) {
    setBusyId(id);
    setError(null);
    setKillError(undefined);
    // admin-service feature-flags/routes.ts killBody: reason 3..500 chars,
    // recorded in the audit event alongside the actor.
    const result = await callApi(`/${id}/kill`, "POST", { reason });
    if (!result.ok) {
      setKillError(result.message);
    } else {
      setKillTarget(null);
      await refresh();
    }
    setBusyId(null);
  }

  async function handleToggle(flag: AdminFeatureFlagRow) {
    setBusyId(flag.id);
    setError(null);
    const result = await callApi(`/${flag.id}`, "PUT", { enabled: !flag.enabled });
    if (!result.ok) setError(result.message ?? null);
    else await refresh();
    setBusyId(null);
  }

  function closeDialog() {
    if (creating) return;
    setDialog(null);
    setFieldErrors({});
    formError.clear();
  }

  async function sendEdit(flag: AdminFeatureFlagRow, patch: Record<string, unknown>): Promise<boolean> {
    setCreating(true);
    const result = await callApi(`/${flag.id}`, "PUT", patch);
    setCreating(false);
    if (!result.ok) return false;
    toast.success(`Flag updated: ${flag.name}`);
    await refresh();
    return true;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    formError.clear();
    const editing = dialog !== null && dialog !== "create" ? dialog : null;
    const fd = new FormData(e.currentTarget);
    const parsed = validateFlagForm({
      key: editing ? editing.key : String(fd.get("key") ?? ""),
      name: String(fd.get("name") ?? ""),
      description: String(fd.get("description") ?? ""),
      rolloutPercent: fd.get("rollout") === "" ? Number.NaN : Number(fd.get("rollout") ?? 0),
      targetSegments: parseSegments(String(fd.get("segments") ?? "")),
      owner: String(fd.get("owner") ?? ""),
    });
    if (!parsed.ok) {
      setFieldErrors(parsed.errors);
      return;
    }
    setFieldErrors({});
    const v = parsed.value;

    if (editing) {
      const patch = {
        name: v.name,
        description: v.description,
        rolloutPercent: v.rolloutPercent,
        targetSegments: v.targetSegments,
        owner: v.owner,
      };
      if (v.rolloutPercent > editing.rolloutPercent) {
        setDialog(null);
        setPendingError(undefined);
        setPendingEdit({ flag: editing, patch });
        return;
      }
      const ok = await sendEdit(editing, patch);
      if (ok) closeDialog();
      else setError(featureFlagError());
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/proxy/v1/admin/feature-flags/manage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...v, enabled: false }),
      });
      setCreating(false);
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setError(resolved.message);
        return;
      }
      setDialog(null);
      toast.success(`Flag created: ${v.name}`);
      await refresh();
    } catch (caught) {
      setCreating(false);
      setError(formError.fromException("save", caught).message);
    }
  }

  const rows: FlagTableRow[] = flags.map((f) => ({ ...f, status: statusText(f), actions: f.id }));
  const editing = dialog !== null && dialog !== "create" ? dialog : null;
  const formKey = editing ? editing.id : "create";

  return (
    <div className="page-main wrap">
      <PageHeader title="Feature Flags" subtitle="Platform feature toggles with gradual rollout controls and kill switch." back="/admin" />
      <DataSourceBadge source={source} />
      {error && (
        <div role="alert" className="alert bad">
          <p>{error}</p>
        </div>
      )}
      <StatGrid>
        <StatCard icon="🚩" iconBg="#eef2ff" label="Total Flags" value={flags.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active (100%)" value={activeCount} />
        <StatCard icon="🔄" iconBg="#fffaeb" label="Rolling Out" value={partialCount} />
        <StatCard icon="⛔" iconBg="#fce7ee" label="Killed" value={killedCount} />
      </StatGrid>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Flag Registry</h3>
          <Button onClick={() => setDialog("create")}>
            + Create Flag
          </Button>
        </div>

        <DataTable<FlagTableRow>
          columns={[
            { key: "name", label: "Name", render: (f) => (<><strong>{f.name}</strong><br /><small className="mut">{f.description}</small></>) },
            { key: "key", label: "Key", render: (f) => <code>{f.key}</code> },
            { key: "owner", label: "Owner", render: (f) => f.owner || "—" },
            { key: "status", label: "Status", render: (f) => getStatusBadge(f) },
            { key: "rolloutPercent", label: "Rollout", render: (f) => `${f.rolloutPercent}%` },
            { key: "targetSegments", label: "Segments", sortable: false, render: (f) => (f.targetSegments.length > 0 ? f.targetSegments.join(", ") : "—") },
            {
              key: "enabled",
              label: "Enabled",
              render: (f) => (
                <label className="toggle">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={`Toggle ${f.name}`}
                    checked={f.enabled}
                    disabled={f.killSwitch || busyId === f.id}
                    onChange={() => setToggleTarget(f)}
                  />
                  <span className="toggle-slider" />
                  <span> {f.enabled ? "On" : "Off"}</span>
                </label>
              ),
            },
            {
              key: "actions",
              label: "Actions",
              sortable: false,
              render: (f) => (
                <span style={{ display: "inline-flex", gap: 6 }}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDialog(f)}
                    disabled={f.killSwitch || busyId === f.id}
                    aria-label={`Edit ${f.name}`}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => { setKillError(undefined); setKillTarget(f); }}
                    disabled={f.killSwitch || busyId === f.id}
                    aria-label={`Kill switch for ${f.name}`}
                  >
                    {f.killSwitch ? "Killed" : "🛑 Kill"}
                  </Button>
                </span>
              ),
            },
          ]}
          rows={rows}
          rowKey={(r) => r.id}
          sortable
          filterable
          filterPlaceholder="Search flags by name or key…"
          pageSize={15}
          emptyIcon="🚩"
          emptyTitle="No feature flags"
          emptyMessage="No feature flags configured yet."
        />
      </div>

      <ConfirmDialog
        open={killTarget !== null}
        danger
        requireReason
        minReasonLength={3}
        maxReasonLength={500}
        reasonLabel="Reason for killing this flag (recorded in the audit log)"
        title={killTarget ? `Kill switch: ${killTarget.name}` : "Kill switch"}
        description={
          killTarget
            ? `Turns "${killTarget.key}" off immediately for everyone it targets, regardless of rollout or segments. This cannot be undone from this screen.`
            : undefined
        }
        confirmLabel="Kill flag"
        busy={killTarget !== null && busyId === killTarget.id}
        errorMessage={killError}
        onConfirm={(reason) => {
          if (killTarget && reason) void handleKillSwitch(killTarget.id, reason);
        }}
        onCancel={() => { setKillTarget(null); setKillError(undefined); }}
      />

      <ConfirmDialog
        open={toggleTarget !== null}
        title={toggleTarget ? `${toggleTarget.enabled ? "Disable" : "Enable"} ${toggleTarget.name}?` : "Change flag"}
        description={
          toggleTarget
            ? `${toggleTarget.enabled ? "Turns" : "Turns on"} "${toggleTarget.key}" ${toggleTarget.enabled ? "off" : `at ${toggleTarget.rolloutPercent}% rollout`} immediately for everyone it targets.`
            : undefined
        }
        confirmLabel={toggleTarget?.enabled ? "Disable flag" : "Enable flag"}
        danger={toggleTarget?.enabled === true}
        busy={toggleTarget !== null && busyId === toggleTarget.id}
        onConfirm={() => {
          const f = toggleTarget;
          setToggleTarget(null);
          if (f) void handleToggle(f);
        }}
        onCancel={() => setToggleTarget(null)}
      />

      <ConfirmDialog
        open={pendingEdit !== null}
        title={pendingEdit ? `Increase rollout: ${pendingEdit.flag.name}` : "Increase rollout"}
        description={
          pendingEdit
            ? `Raises "${pendingEdit.flag.key}" from ${pendingEdit.flag.rolloutPercent}% to ${String(pendingEdit.patch.rolloutPercent)}% of its audience. This changes live traffic as soon as it is applied.`
            : undefined
        }
        confirmLabel="Apply rollout change"
        busy={creating}
        errorMessage={pendingError}
        onConfirm={() => {
          if (!pendingEdit) return;
          void (async () => {
            setPendingError(undefined);
            const ok = await sendEdit(pendingEdit.flag, pendingEdit.patch);
            if (ok) setPendingEdit(null);
            else setPendingError(featureFlagError());
          })();
        }}
        onCancel={() => { setPendingEdit(null); setPendingError(undefined); }}
      />

      {/* GAP-ADMIN-FEATURE-FLAGS-06: Modal supplies focus-in, Tab trap, Escape, overlay
          click and focus return to the trigger. Closing is blocked while a save is in flight. */}
      <Modal
        open={dialog !== null}
        onClose={closeDialog}
        closeOnOverlayClick={!creating}
        size="md"
        title={editing ? `Edit feature flag: ${editing.name}` : "Create Feature Flag"}
      >
        <form onSubmit={(e) => void handleSubmit(e)} key={formKey} noValidate>
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="flag-name">Name</label>
            <input id="flag-name" name="name" type="text" className="input" placeholder="My Feature" defaultValue={editing?.name ?? ""} required />
            {(fieldErrors.name ?? formError.fieldError("name")) && (
              <span role="alert" className="mut" style={{ display: "block", fontSize: 12, color: "var(--bad)", marginTop: 4 }}>{fieldErrors.name ?? formError.fieldError("name")}</span>
            )}
          </div>
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="flag-key">Key</label>
            <input id="flag-key" name="key" type="text" className="input" placeholder="my-feature" defaultValue={editing?.key ?? ""} readOnly={editing !== null} required />
            {(fieldErrors.key ?? formError.fieldError("key")) && (
              <span role="alert" style={{ display: "block", fontSize: 12, color: "var(--bad)", marginTop: 4 }}>{fieldErrors.key ?? formError.fieldError("key")}</span>
            )}
          </div>
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="flag-desc">Description</label>
            <textarea id="flag-desc" name="description" className="input" placeholder="Description..." defaultValue={editing?.description ?? ""} />
            {(fieldErrors.description ?? formError.fieldError("description")) && (
              <span role="alert" style={{ display: "block", fontSize: 12, color: "var(--bad)", marginTop: 4 }}>{fieldErrors.description ?? formError.fieldError("description")}</span>
            )}
          </div>
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="flag-owner">Owner</label>
            <input id="flag-owner" name="owner" type="text" className="input" placeholder="team or person" defaultValue={editing?.owner ?? ""} />
            {fieldErrors.owner && (
              <span role="alert" style={{ display: "block", fontSize: 12, color: "var(--bad)", marginTop: 4 }}>{fieldErrors.owner}</span>
            )}
          </div>
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="flag-rollout">Rollout Percent (0-100)</label>
            <input id="flag-rollout" name="rollout" type="number" min={0} max={100} step={1} className="input" defaultValue={editing?.rolloutPercent ?? 0} />
            {(fieldErrors.rolloutPercent ?? formError.fieldError("rolloutPercent")) && (
              <span role="alert" style={{ display: "block", fontSize: 12, color: "var(--bad)", marginTop: 4 }}>{fieldErrors.rolloutPercent ?? formError.fieldError("rolloutPercent")}</span>
            )}
          </div>
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="flag-segments">Target Segments (comma-separated)</label>
            <input id="flag-segments" name="segments" type="text" className="input" placeholder="beta, internal" defaultValue={editing?.targetSegments.join(", ") ?? ""} />
            {(fieldErrors.targetSegments ?? formError.fieldError("targetSegments")) && (
              <span role="alert" style={{ display: "block", fontSize: 12, color: "var(--bad)", marginTop: 4 }}>{fieldErrors.targetSegments ?? formError.fieldError("targetSegments")}</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button type="button" variant="ghost" onClick={closeDialog} disabled={creating}>Cancel</Button>
            <Button type="submit" disabled={creating} loading={creating}>{creating ? "Saving…" : "Save"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
