"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card, DataTable, EmptyState, ConfirmDialog, StatGrid, StatCard } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { CreateLeavePolicyForm } from "./CreateLeavePolicyForm";

type Policy = {
  id: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  employeeType: string;
  maxDaysPerYear: number;
  carryForward: boolean;
  maxAccumulation: number;
  encashable: boolean;
  countMethod: string;
  maxContinuousDays: number;
  minServiceMonths: number;
  genderRestriction: string | null;
  requiresMedicalCert: boolean;
  requiresMedicalCertAfterDays: number;
  prefixSuffixRule: boolean;
  sandwichRule: boolean;
  proRataOnJoining: boolean;
  isActive: boolean;
};

type PolicyRow = Policy & Record<string, unknown>;

const EMPLOYEE_TYPES = ["permanent", "contractual", "vendor_deputed", "deputation", "consultant"];

const TYPE_VARIANT: Record<string, string> = {
  permanent: "info",
  contractual: "warn",
  vendor_deputed: "info",
  deputation: "good",
  consultant: "mut",
};

type LoadState = "loading" | "ready" | "error";

export default function LeavePoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [state, setState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editId, setEditId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<Policy>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [toast, setToast] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  async function fetchPolicies() {
    setState("loading");
    setLoadError(null);
    try {
      const url =
        filter === "all"
          ? "/api/proxy/v1/hrms/admin/leave-policies"
          : `/api/proxy/v1/hrms/admin/leave-policies?employeeType=${filter}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error((await res.text()) || `Failed to load policies (${res.status})`);
      const data = await res.json();
      setPolicies(data.data ?? []);
      setState("ready");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load leave policies.");
      setState("error");
    }
  }

  useEffect(() => {
    void fetchPolicies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  function startEdit(p: Policy) {
    setEditId(p.id);
    setSaveError(undefined);
    setEditValues({
      maxDaysPerYear: p.maxDaysPerYear,
      carryForward: p.carryForward,
      maxAccumulation: p.maxAccumulation,
      encashable: p.encashable,
      countMethod: p.countMethod,
      maxContinuousDays: p.maxContinuousDays,
      minServiceMonths: p.minServiceMonths,
      requiresMedicalCert: p.requiresMedicalCert,
      requiresMedicalCertAfterDays: p.requiresMedicalCertAfterDays,
      prefixSuffixRule: p.prefixSuffixRule,
      sandwichRule: p.sandwichRule,
      proRataOnJoining: p.proRataOnJoining,
    });
  }

  async function saveEdit() {
    if (!editId) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/admin/leave-policies/${editId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editValues),
      });
      if (!res.ok) throw new Error((await res.text()) || `Update failed (${res.status})`);
      setConfirmOpen(false);
      setEditId(null);
      setToast({ tone: "good", text: "Policy updated successfully." });
      await fetchPolicies();
      setTimeout(() => setToast(null), 4000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to update policy.");
    } finally {
      setSaving(false);
    }
  }

  const editingPolicy = policies.find((p) => p.id === editId) ?? null;
  const rows: PolicyRow[] = policies as PolicyRow[];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Leave Policy Configuration"
        subtitle="Configure leave entitlements for each employee type. Changes take effect immediately."
      />
      <DataSourceBadge source={state === "error" ? "error" : "api"} />
      {state === "ready" && policies.length > 0 && (
        <StatGrid>
          <StatCard icon="\U0001f4cb" iconBg="#e6f0ff" label="Total Policies"   value={policies.length} />
          <StatCard icon="\u2705"       iconBg="#e6f7f0" label="Active"           value={policies.filter((p) => p.isActive).length} />
          <StatCard icon="\U0001f501" iconBg="#fff7e6" label="Carry Forward"    value={policies.filter((p) => p.carryForward).length} />
          <StatCard icon="\U0001f4b0" iconBg="#f5f5f5" label="Encashable"       value={policies.filter((p) => p.encashable).length} />
        </StatGrid>
      )}

      <div role="group" aria-label="Filter by employee type" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {[{ value: "all", label: "All Types" }, ...EMPLOYEE_TYPES.map((t) => ({ value: t, label: t.replace("_", " ") }))].map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={filter === o.value}
            className={`btn sm ${filter === o.value ? "primary" : "ghost"}`}
            style={{ textTransform: "capitalize", minHeight: 40 }}
            onClick={() => setFilter(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>

      {toast && (
        <p role="status" aria-live="polite" className={`pill ${toast.tone}`} style={{ margin: "0 0 12px" }}>
          {toast.text}
        </p>
      )}

      <Card title="Leave Policies">
        {state === "loading" ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--mut)" }} aria-live="polite">
            Loading policies…
          </div>
        ) : state === "error" ? (
          <EmptyState
            icon="⚠️"
            title="Could not load policies"
            message={loadError ?? "Something went wrong."}
            action={
              <button type="button" className="btn ghost" onClick={() => void fetchPolicies()}>
                Retry
              </button>
            }
          />
        ) : policies.length === 0 ? (
          <EmptyState
            icon="📋"
            title="No policies configured"
            message="No leave policies match the selected employee type."
          />
        ) : (
          <DataTable<PolicyRow>
            columns={[
              {
                key: "employeeType",
                label: "Employee Type",
                render: (p) => (
                  <span className={`pill ${TYPE_VARIANT[p.employeeType as string] ?? "mut"}`} style={{ textTransform: "capitalize" }}>
                    {(p.employeeType as string).replace("_", " ")}
                  </span>
                ),
              },
              {
                key: "leaveTypeName",
                label: "Leave Type",
                render: (p) => (
                  <>
                    <span style={{ fontSize: 11, color: "var(--mut)", marginRight: 4 }}>{p.leaveTypeCode as string}</span>
                    {p.leaveTypeName as string}
                  </>
                ),
              },
              {
                key: "maxDaysPerYear",
                label: "Days/Year",
                align: "center",
                render: (p) => {
                  if (editId === (p.id as string)) {
                    return (
                      <>
                        <label className="sr-only" htmlFor={`days-${p.id as string}`}>Days per year</label>
                        <input
                          id={`days-${p.id as string}`}
                          type="number"
                          style={{ width: 64, textAlign: "center", padding: 6, border: "1px solid var(--line)", borderRadius: 8 }}
                          value={editValues.maxDaysPerYear ?? 0}
                          onChange={(e) => setEditValues({ ...editValues, maxDaysPerYear: Number(e.target.value) })}
                        />
                      </>
                    );
                  }
                  return <span style={{ fontWeight: 700, color: "var(--primary-d)" }}>{p.maxDaysPerYear as number}</span>;
                },
              },
              {
                key: "maxContinuousDays",
                label: "Max Continuous",
                align: "center",
                render: (p) => {
                  if (editId === (p.id as string)) {
                    return (
                      <>
                        <label className="sr-only" htmlFor={`cont-${p.id as string}`}>Max continuous days</label>
                        <input
                          id={`cont-${p.id as string}`}
                          type="number"
                          style={{ width: 64, textAlign: "center", padding: 6, border: "1px solid var(--line)", borderRadius: 8 }}
                          value={editValues.maxContinuousDays ?? 0}
                          onChange={(e) => setEditValues({ ...editValues, maxContinuousDays: Number(e.target.value) })}
                        />
                      </>
                    );
                  }
                  return <span style={{ color: "var(--ink2)" }}>{p.maxContinuousDays as number}d</span>;
                },
              },
              {
                key: "carryForward",
                label: "Carry Fwd",
                align: "center",
                render: (p) => {
                  if (editId === (p.id as string)) {
                    return (
                      <input
                        type="checkbox"
                        aria-label="Carry forward"
                        checked={editValues.carryForward ?? false}
                        onChange={(e) => setEditValues({ ...editValues, carryForward: e.target.checked })}
                      />
                    );
                  }
                  return p.carryForward ? <span aria-label="Yes">✓</span> : <span aria-label="No">—</span>;
                },
              },
              {
                key: "encashable",
                label: "Encashable",
                align: "center",
                render: (p) => {
                  if (editId === (p.id as string)) {
                    return (
                      <input
                        type="checkbox"
                        aria-label="Encashable"
                        checked={editValues.encashable ?? false}
                        onChange={(e) => setEditValues({ ...editValues, encashable: e.target.checked })}
                      />
                    );
                  }
                  return p.encashable ? <span aria-label="Encashable">💰</span> : <span aria-label="No">—</span>;
                },
              },
              {
                key: "countMethod",
                label: "Count Method",
                align: "center",
                render: (p) => {
                  if (editId === (p.id as string)) {
                    return (
                      <>
                        <label className="sr-only" htmlFor={`cm-${p.id as string}`}>Count method</label>
                        <select
                          id={`cm-${p.id as string}`}
                          style={{ padding: 6, border: "1px solid var(--line)", borderRadius: 8 }}
                          value={editValues.countMethod ?? "calendar"}
                          onChange={(e) => setEditValues({ ...editValues, countMethod: e.target.value })}
                        >
                          <option value="calendar">Calendar</option>
                          <option value="working_days">Working Days</option>
                        </select>
                      </>
                    );
                  }
                  return <span style={{ fontSize: 12 }}>{(p.countMethod as string) === "working_days" ? "Working" : "Calendar"}</span>;
                },
              },
              {
                key: "requiresMedicalCert",
                label: "Med Cert",
                align: "center",
                render: (p) => {
                  if (editId === (p.id as string)) {
                    return (
                      <input
                        type="checkbox"
                        aria-label="Requires medical certificate"
                        checked={editValues.requiresMedicalCert ?? false}
                        onChange={(e) => setEditValues({ ...editValues, requiresMedicalCert: e.target.checked })}
                      />
                    );
                  }
                  return (p.requiresMedicalCert as boolean)
                    ? <span><span aria-hidden="true">⚕️</span> &gt;{p.requiresMedicalCertAfterDays as number}d</span>
                    : <span aria-label="Not required">—</span>;
                },
              },
              {
                key: "sandwichRule",
                label: "Sandwich",
                align: "center",
                render: (p) => {
                  if (editId === (p.id as string)) {
                    return (
                      <input
                        type="checkbox"
                        aria-label="Sandwich rule"
                        checked={editValues.sandwichRule ?? false}
                        onChange={(e) => setEditValues({ ...editValues, sandwichRule: e.target.checked })}
                      />
                    );
                  }
                  return p.sandwichRule ? <span aria-label="Yes">✓</span> : <span aria-label="No">—</span>;
                },
              },
              {
                key: "minServiceMonths",
                label: "Min Service",
                align: "center",
                render: (p) => {
                  if (editId === (p.id as string)) {
                    return (
                      <>
                        <label className="sr-only" htmlFor={`svc-${p.id as string}`}>Minimum service months</label>
                        <input
                          id={`svc-${p.id as string}`}
                          type="number"
                          style={{ width: 56, textAlign: "center", padding: 6, border: "1px solid var(--line)", borderRadius: 8 }}
                          value={editValues.minServiceMonths ?? 0}
                          onChange={(e) => setEditValues({ ...editValues, minServiceMonths: Number(e.target.value) })}
                        />
                        {" "}<span style={{ fontSize: 11, color: "var(--mut)" }}>mo</span>
                      </>
                    );
                  }
                  return (
                    <span style={{ fontSize: 12, color: "var(--ink2)" }}>
                      {(p.minServiceMonths as number) > 0 ? `${p.minServiceMonths as number}mo` : "—"}
                    </span>
                  );
                },
              },
              {
                key: "id",
                label: "Actions",
                align: "center",
                sortable: false,
                render: (p) => {
                  if (editId === (p.id as string)) {
                    return (
                      <div style={{ display: "inline-flex", gap: 6 }}>
                        <button
                          type="button"
                          className="btn primary sm"
                          disabled={saving}
                          onClick={() => { setSaveError(undefined); setConfirmOpen(true); }}
                        >
                          Save
                        </button>
                        <button type="button" className="btn ghost sm" onClick={() => setEditId(null)}>
                          Cancel
                        </button>
                      </div>
                    );
                  }
                  return (
                    <button type="button" className="btn ghost sm" onClick={() => startEdit(p as Policy)}>
                      Edit
                    </button>
                  );
                },
              },
            ]}
            rows={rows}
            sortable
            filterable
            pageSize={20}
          />
        )}
      </Card>

      <div style={{ marginTop: 16, padding: 14, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 12, fontSize: 12, color: "var(--ink2)" }}>
        <strong style={{ color: "var(--ink)" }}>Legend:</strong> ✓ = Yes · — = No ·{" "}
        <span aria-hidden="true">💰</span> Encashable · <span aria-hidden="true">⚕️</span> Medical certificate required ·
        Working = excludes weekends + holidays · Calendar = all days counted.
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Save policy changes?"
        confirmLabel="Save changes"
        busy={saving}
        errorMessage={saveError}
        description={
          editingPolicy ? (
            <>
              Update the <strong>{editingPolicy.leaveTypeName}</strong> policy for{" "}
              <strong style={{ textTransform: "capitalize" }}>{editingPolicy.employeeType.replace("_", " ")}</strong>{" "}
              employees. Changes take effect immediately for new applications.
            </>
          ) : (
            "Apply the edited values to this leave policy."
          )
        }
        onConfirm={() => void saveEdit()}
        onCancel={() => !saving && setConfirmOpen(false)}
      />
    </main>
  );
}
