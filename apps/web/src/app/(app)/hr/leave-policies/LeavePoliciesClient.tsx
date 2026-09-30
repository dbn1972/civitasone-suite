"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PageHeader, Card, DataTable, EmptyState, ErrorState, ConfirmDialog, StatGrid, StatCard, StatusPill, SkeletonTable, Button } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { CreateLeavePolicyForm } from "./CreateLeavePolicyForm";
import { useFormError } from "@/lib/useFormError";

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

// Kept in sync with employeeTypeEnum in policy-admin-routes.ts and
// CreateLeavePolicyForm's own EMPLOYEE_TYPES — previously only 5 of the 9
// backend-supported types were listed here, so a policy created for e.g.
// "temporary" or "intern" (allowed by the create form and the backend
// validator) had no dedicated filter button, only "All Types".
const EMPLOYEE_TYPES = [
  "permanent", "contractual", "vendor_deputed", "deputation", "consultant",
  "temporary", "intern", "apprentice", "volunteer",
];

const TYPE_VARIANT: Record<string, string> = {
  permanent: "info",
  contractual: "warn",
  vendor_deputed: "info",
  deputation: "good",
  consultant: "mut",
};

type LoadState = "loading" | "ready" | "error";

export default function LeavePoliciesClient() {
  const t = useTranslations("leavePolicies");
  // GAP-HR-LEAVE-POLICIES-07: employeeTypes i18n map lives in the
  // leavePolicyForm namespace (shared with CreateLeavePolicyForm's own
  // <select> options), not leavePolicies.
  const tf = useTranslations("leavePolicyForm");
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
  const formError = useFormError("leave policy");

  // GAP-HR-LEAVE-POLICIES-05: startEdit used to unconditionally overwrite
  // editId/editValues, so clicking Edit on row B while row A had unsaved
  // changes silently discarded A's edit with no warning. pendingEditTarget
  // holds the row the user just clicked Edit on while a DIFFERENT row is
  // dirty; discardConfirmOpen gates a "Discard changes?" prompt before
  // switching.
  const [pendingEditTarget, setPendingEditTarget] = useState<Policy | null>(null);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  // GAP-HR-LEAVE-POLICIES-04: policies whose Deactivate/Reactivate request
  // is in flight — used to disable that row's own action button only
  // (independent of `saving`, which is the inline-edit Save/Cancel state).
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<Policy | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | undefined>();

  async function fetchPolicies(signal?: AbortSignal) {
    setState("loading");
    setLoadError(null);
    try {
      const url =
        filter === "all"
          ? "/api/proxy/v1/hrms/admin/leave-policies"
          : `/api/proxy/v1/hrms/admin/leave-policies?employeeType=${filter}`;
      const res = await fetch(url, { signal });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "load");
        setLoadError(resolved.message);
        setState("error");
        return;
      }
      const data = await res.json();
      setPolicies(data.data ?? []);
      setState("ready");
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setLoadError(formError.fromException("load").message);
        setState("error");
      }
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    void fetchPolicies(controller.signal)
    return () => controller.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchPolicies is redefined each render but only closes over values already listed in this array; nothing else it reads can change independently.
  }, [filter]);

  // GAP-HR-LEAVE-POLICIES-05: does `values` differ from `original` on any
  // field the edit form actually exposes?
  function isDirty(original: Policy | null, values: Partial<Policy>): boolean {
    if (!original) return false;
    return (Object.keys(values) as (keyof Policy)[]).some((k) => values[k] !== original[k]);
  }

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

  // GAP-HR-LEAVE-POLICIES-05: the Edit button's actual onClick target now.
  // Only prompts when switching away from a DIFFERENT row that has unsaved
  // changes; clicking Edit again on the row already being edited, or on any
  // row when nothing is dirty, behaves exactly as before.
  function requestEdit(p: Policy) {
    if (editId && editId !== p.id) {
      const current = policies.find((x) => x.id === editId) ?? null;
      if (isDirty(current, editValues)) {
        setPendingEditTarget(p);
        setDiscardConfirmOpen(true);
        return;
      }
    }
    startEdit(p);
  }

  function confirmDiscardAndSwitch() {
    setDiscardConfirmOpen(false);
    if (pendingEditTarget) startEdit(pendingEditTarget);
    setPendingEditTarget(null);
  }

  async function saveEdit() {
    if (!editId) return;
    const editedId = editId;
    const snapshot = editValues;
    setSaving(true);
    setSaveError(undefined);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/admin/leave-policies/${editedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editValues),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setSaveError(resolved.message);
        return;
      }
      // GAP-HR-LEAVE-POLICIES-03: PATCH is a queued write (202, applied
      // later by f3-consumer.ts) — an immediate refetch can still return the
      // pre-write row. Apply the edited values to local state right away
      // (optimistic) instead of waiting on that refetch, and say "submitted"
      // rather than "updated" since the change may not be visible to a
      // fresh GET for a moment yet.
      setPolicies((prev) => prev.map((p) => (p.id === editedId ? { ...p, ...snapshot } : p)));
      setConfirmOpen(false);
      setEditId(null);
      setToast({ tone: "good", text: t("toastUpdated") });
      setTimeout(() => setToast(null), 4000);
      // Background reconcile: confirm the optimistic view against the real,
      // by-then-likely-consistent server state without re-entering the
      // full-page loading state (fetchPolicies() itself doesn't toggle
      // `state` back to "loading" mid-session since `state` is already
      // "ready" here, so this is already a quiet background refresh).
      setTimeout(() => { void fetchPolicies(); }, 1500);
    } catch {
      setSaveError(formError.fromException("save").message);
    } finally {
      setSaving(false);
    }
  }

  // GAP-HR-LEAVE-POLICIES-04: the DELETE endpoint (deactivate) already
  // existed server-side (policy-admin-routes.ts) but had no caller in the
  // web app; PATCH {isActive:true} reactivates (updatePolicyBody now
  // accepts isActive). Both are queued writes (202) — same optimistic +
  // delayed-reconcile pattern as saveEdit above, and both go through a
  // reason-collecting ConfirmDialog since either one changes an employee
  // type's leave entitlement.
  async function submitStatusChange(p: Policy, nextActive: boolean, reason?: string) {
    setStatusBusyId(p.id);
    setDeactivateError(undefined);
    try {
      const res = nextActive
        ? await fetch(`/api/proxy/v1/hrms/admin/leave-policies/${p.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isActive: true }),
          })
        : await fetch(`/api/proxy/v1/hrms/admin/leave-policies/${p.id}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason }),
          });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setDeactivateError(resolved.message);
        return;
      }
      setPolicies((prev) => prev.map((x) => (x.id === p.id ? { ...x, isActive: nextActive } : x)));
      setDeactivateTarget(null);
      // Reuses toastUpdated's copy ("Change submitted…") rather than adding
      // toastDeactivated/toastReactivated keys — same queued-write shape as
      // an ordinary field edit, so the same message applies.
      setToast({ tone: "good", text: t("toastUpdated") });
      setTimeout(() => setToast(null), 4000);
      setTimeout(() => { void fetchPolicies(); }, 1500);
    } catch {
      setDeactivateError(formError.fromException("save").message);
    } finally {
      setStatusBusyId(null);
    }
  }

  async function handlePolicyCreated() {
    // GAP-HR-LEAVE-POLICIES-03: same queued-write timing issue as saveEdit
    // — "submitted", not "created", and a short delay before reconciling.
    setToast({ tone: "good", text: t("toastCreated") });
    setTimeout(() => setToast(null), 4000);
    setTimeout(() => { void fetchPolicies(); }, 1500);
  }

  const editingPolicy = policies.find((p) => p.id === editId) ?? null;
  const rows: PolicyRow[] = policies as PolicyRow[];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
      />
      <DataSourceBadge source={state === "error" ? "error" : "api"} />
      {state === "ready" && policies.length > 0 && (
        <StatGrid>
          <StatCard icon="📋" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")} value={policies.length} />
          <StatCard icon="✅"       iconBg="var(--goodbg, #e6f7f0)" label={t("statActive")} value={policies.filter((p) => p.isActive).length} />
          <StatCard icon="🔁" iconBg="var(--warnbg, #fff7e6)" label={t("statCarryForward")} value={policies.filter((p) => p.carryForward).length} />
          <StatCard icon="💰" iconBg="var(--bg, #f5f5f5)" label={t("statEncashable")} value={policies.filter((p) => p.encashable).length} />
        </StatGrid>
      )}

      <div role="group" aria-label={t("filterGroupLabel")} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {[{ value: "all", label: t("allTypes") }, ...EMPLOYEE_TYPES.map((type) => ({ value: type, label: tf(`employeeTypes.${type}`) }))].map((o) => (
          <Button
            key={o.value}
            variant={filter === o.value ? "primary" : "ghost"}
            size="sm"
            aria-pressed={filter === o.value}
            style={{ textTransform: "capitalize", minHeight: 40 }}
            onClick={() => setFilter(o.value)}
          >
            {o.label}
          </Button>
        ))}
      </div>

      {toast && (
        <p role="status" aria-live="polite" className={`pill ${toast.tone}`} style={{ margin: "0 0 12px" }}>
          {toast.text}
        </p>
      )}

      <CreateLeavePolicyForm onCreated={() => void handlePolicyCreated()} />

      <Card title={t("cardTitle")}>
        {state === "loading" ? (
          // GAP-HR-LEAVE-POLICIES-06: was plain "Loading policies…" text —
          // every sibling HR loading treatment uses SkeletonTable.
          <SkeletonTable rows={6} />
        ) : state === "error" ? (
          // GAP-HR-LEAVE-POLICIES-06: EmptyState was being used as the error
          // surface. Switched to ErrorState, keeping the same two pieces of
          // text the old EmptyState(icon/title/message) showed — errorTitle
          // as the heading, `loadError` (UX-016's already clerk-safe,
          // formError-derived message) as the detail — rather than
          // discarding either.
          <ErrorState
            error={{ what: t("errorTitle"), next: loadError ?? t("errorFallback"), actions: ["retry"] }}
            onRetry={() => void fetchPolicies()}
          />
        ) : policies.length === 0 ? ( // ux-001-ok: gated by `state === "error"` above (a real distinct branch with its own message + retry button, just spelled "state" not "source"/"status" so the guard's regex misses it)
          <EmptyState
            icon="📋"
            title={t("emptyTitle")}
            message={t("emptyMessage")}
          />
        ) : (
          <DataTable<PolicyRow>
            columns={[
              {
                key: "employeeType",
                label: t("colEmployeeType"),
                render: (p) => (
                  <span className={`pill ${TYPE_VARIANT[p.employeeType as string] ?? "mut"}`}>
                    {tf(`employeeTypes.${p.employeeType as string}`)}
                  </span>
                ),
              },
              {
                key: "isActive",
                label: t("colStatus"),
                align: "center",
                render: (p) => <StatusPill status={p.isActive ? "active" : "inactive"} />,
              },
              {
                key: "leaveTypeName",
                label: t("colLeaveType"),
                render: (p) => (
                  <>
                    <span style={{ fontSize: 11, color: "var(--mut)", marginRight: 4 }}>{p.leaveTypeCode as string}</span>
                    {p.leaveTypeName as string}
                  </>
                ),
              },
              {
                key: "maxDaysPerYear",
                label: t("colDaysPerYear"),
                align: "center",
                render: (p) => {
                  if (editId === (p.id as string)) {
                    return (
                      <>
                        <label className="sr-only" htmlFor={`days-${p.id as string}`}>{t("srDaysPerYear")}</label>
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
                label: t("colMaxContinuous"),
                align: "center",
                render: (p) => {
                  if (editId === (p.id as string)) {
                    return (
                      <>
                        <label className="sr-only" htmlFor={`cont-${p.id as string}`}>{t("srMaxContinuousDays")}</label>
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
                label: t("colCarryFwd"),
                align: "center",
                render: (p) => {
                  if (editId === (p.id as string)) {
                    return (
                      <input
                        type="checkbox"
                        aria-label={t("ariaCarryForward")}
                        checked={editValues.carryForward ?? false}
                        onChange={(e) => setEditValues({ ...editValues, carryForward: e.target.checked })}
                      />
                    );
                  }
                  return p.carryForward ? <span aria-label={t("ariaYes")}>✓</span> : <span aria-label={t("ariaNo")}>—</span>;
                },
              },
              {
                key: "encashable",
                label: t("colEncashable"),
                align: "center",
                render: (p) => {
                  if (editId === (p.id as string)) {
                    return (
                      <input
                        type="checkbox"
                        aria-label={t("ariaEncashable")}
                        checked={editValues.encashable ?? false}
                        onChange={(e) => setEditValues({ ...editValues, encashable: e.target.checked })}
                      />
                    );
                  }
                  return p.encashable ? <span aria-label={t("ariaEncashable")}>💰</span> : <span aria-label={t("ariaNo")}>—</span>;
                },
              },
              {
                key: "countMethod",
                label: t("colCountMethod"),
                align: "center",
                render: (p) => {
                  if (editId === (p.id as string)) {
                    return (
                      <>
                        <label className="sr-only" htmlFor={`cm-${p.id as string}`}>{t("srCountMethod")}</label>
                        <select
                          id={`cm-${p.id as string}`}
                          style={{ padding: 6, border: "1px solid var(--line)", borderRadius: 8 }}
                          value={editValues.countMethod ?? "calendar"}
                          onChange={(e) => setEditValues({ ...editValues, countMethod: e.target.value })}
                        >
                          <option value="calendar">{t("optionCalendar")}</option>
                          <option value="working_days">{t("optionWorkingDays")}</option>
                        </select>
                      </>
                    );
                  }
                  return <span style={{ fontSize: 12 }}>{(p.countMethod as string) === "working_days" ? t("countWorkingShort") : t("optionCalendar")}</span>;
                },
              },
              {
                key: "requiresMedicalCert",
                label: t("colMedCert"),
                align: "center",
                render: (p) => {
                  if (editId === (p.id as string)) {
                    return (
                      <input
                        type="checkbox"
                        aria-label={t("ariaRequiresMedCert")}
                        checked={editValues.requiresMedicalCert ?? false}
                        onChange={(e) => setEditValues({ ...editValues, requiresMedicalCert: e.target.checked })}
                      />
                    );
                  }
                  return (p.requiresMedicalCert as boolean)
                    ? <span><span aria-hidden="true">⚕️</span> &gt;{p.requiresMedicalCertAfterDays as number}d</span>
                    : <span aria-label={t("notRequired")}>—</span>;
                },
              },
              {
                key: "sandwichRule",
                label: t("colSandwich"),
                align: "center",
                render: (p) => {
                  if (editId === (p.id as string)) {
                    return (
                      <input
                        type="checkbox"
                        aria-label={t("ariaSandwichRule")}
                        checked={editValues.sandwichRule ?? false}
                        onChange={(e) => setEditValues({ ...editValues, sandwichRule: e.target.checked })}
                      />
                    );
                  }
                  return p.sandwichRule ? <span aria-label={t("ariaYes")}>✓</span> : <span aria-label={t("ariaNo")}>—</span>;
                },
              },
              {
                key: "minServiceMonths",
                label: t("colMinService"),
                align: "center",
                render: (p) => {
                  if (editId === (p.id as string)) {
                    return (
                      <>
                        <label className="sr-only" htmlFor={`svc-${p.id as string}`}>{t("srMinServiceMonths")}</label>
                        <input
                          id={`svc-${p.id as string}`}
                          type="number"
                          style={{ width: 56, textAlign: "center", padding: 6, border: "1px solid var(--line)", borderRadius: 8 }}
                          value={editValues.minServiceMonths ?? 0}
                          onChange={(e) => setEditValues({ ...editValues, minServiceMonths: Number(e.target.value) })}
                        />
                        {" "}<span style={{ fontSize: 11, color: "var(--mut)" }}>{t("monthsShort")}</span>
                      </>
                    );
                  }
                  return (
                    <span style={{ fontSize: 12, color: "var(--ink2)" }}>
                      {(p.minServiceMonths as number) > 0 ? `${p.minServiceMonths as number}${t("monthsShort")}` : "—"}
                    </span>
                  );
                },
              },
              {
                key: "id",
                label: t("colActions"),
                align: "center",
                sortable: false,
                render: (p) => {
                  if (editId === (p.id as string)) {
                    return (
                      <div style={{ display: "inline-flex", gap: 6 }}>
                        <Button
                          size="sm"
                          disabled={saving}
                          onClick={() => { setSaveError(undefined); setConfirmOpen(true); }}
                        >
                          {t("saveBtn")}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditId(null)}>
                          {t("cancelBtn")}
                        </Button>
                      </div>
                    );
                  }
                  return (
                    <div style={{ display: "inline-flex", gap: 6 }}>
                      <Button variant="ghost" size="sm" onClick={() => requestEdit(p as Policy)}>
                        {t("editBtn")}
                      </Button>
                      {/* GAP-HR-LEAVE-POLICIES-04: DELETE (deactivate) already existed
                          server-side with no web caller; PATCH {isActive:true} reactivates. */}
                      {(p as Policy).isActive ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={statusBusyId === (p.id as string)}
                          onClick={() => { setDeactivateError(undefined); setDeactivateTarget(p as Policy); }}
                        >
                          {t("deactivateBtn")}
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={statusBusyId === (p.id as string)}
                          onClick={() => void submitStatusChange(p as Policy, true)}
                        >
                          {t("reactivateBtn")}
                        </Button>
                      )}
                    </div>
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
        <strong style={{ color: "var(--ink)" }}>{t("legendTitle")}</strong> {t("legendYesNo")}{" "}
        <span aria-hidden="true">💰</span> {t("legendEncashableLabel")} <span aria-hidden="true">⚕️</span> {t("legendMedCertLabel")}
        {" "}{t("legendFooter")}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmSaveTitle")}
        confirmLabel={t("confirmSaveLabel")}
        busy={saving}
        errorMessage={saveError}
        description={
          editingPolicy ? (
            t.rich("confirmDescRich", {
              leaveType: editingPolicy.leaveTypeName,
              employeeType: tf(`employeeTypes.${editingPolicy.employeeType}`),
              strongType: (chunks) => <strong>{chunks}</strong>,
              strongEmp: (chunks) => <strong>{chunks}</strong>,
            })
          ) : (
            t("confirmDescDefault")
          )
        }
        onConfirm={() => void saveEdit()}
        onCancel={() => !saving && setConfirmOpen(false)}
      />

      {/* GAP-HR-LEAVE-POLICIES-05: discard-unsaved-edit guard */}
      <ConfirmDialog
        open={discardConfirmOpen}
        title={t("discardTitle")}
        confirmLabel={t("discardConfirmLabel")}
        description={t("discardDescription")}
        onConfirm={confirmDiscardAndSwitch}
        onCancel={() => { setDiscardConfirmOpen(false); setPendingEditTarget(null); }}
      />

      {/* GAP-HR-LEAVE-POLICIES-04: deactivate requires a reason (changes a
          live employee type's leave entitlement); reactivate does not. */}
      <ConfirmDialog
        open={deactivateTarget !== null}
        title={t("confirmDeactivateTitle")}
        confirmLabel={t("deactivateBtn")}
        danger
        requireReason
        reasonLabel={t("deactivateReasonLabel")}
        busy={statusBusyId === deactivateTarget?.id}
        errorMessage={deactivateError}
        description={
          deactivateTarget
            ? t.rich("confirmDeactivateDescRich", {
                leaveType: deactivateTarget.leaveTypeName,
                employeeType: tf(`employeeTypes.${deactivateTarget.employeeType}`),
                strongType: (chunks) => <strong>{chunks}</strong>,
                strongEmp: (chunks) => <strong>{chunks}</strong>,
              })
            : ""
        }
        onConfirm={(reason) => void submitStatusChange(deactivateTarget as Policy, false, reason)}
        onCancel={() => !statusBusyId && setDeactivateTarget(null)}
      />
    </div>
  );
}
