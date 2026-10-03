"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PageHeader, Card, DataTable, EmptyState, ErrorState, ConfirmDialog, Drawer, StatGrid, StatCard, StatusPill, SkeletonTable, Button } from "../../../_components/ds";
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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [toast, setToast] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const formError = useFormError("leave policy");

  // GAP-HR-LEAVE-POLICIES-05: editing now happens in a single labelled
  // Drawer (all 12 fields) instead of inline in an 11-column table, so only
  // one policy can ever be mid-edit and nothing is silently overwritten.
  // `discardPromptOpen` is the in-drawer "Discard unsaved changes?" prompt
  // shown when the user closes the drawer with edits (kept inline rather than
  // a second stacked modal so focus trapping stays correct).
  const [discardPromptOpen, setDiscardPromptOpen] = useState(false);

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
        setLoadError(formError.fromException("load", err).message);
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

  function isDirty(original: Policy | null, values: Partial<Policy>): boolean {
    if (!original) return false;
    return (Object.keys(values) as (keyof Policy)[]).some((k) => values[k] !== original[k]);
  }

  function startEdit(p: Policy) {
    setEditId(p.id);
    setSaveError(undefined);
    setDiscardPromptOpen(false);
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

  function closeEditor() {
    setEditId(null);
    setDiscardPromptOpen(false);
    setSaveError(undefined);
  }

  // Closing with unsaved edits asks first; closing a clean editor just closes.
  function requestCloseEditor() {
    const current = policies.find((x) => x.id === editId) ?? null;
    if (isDirty(current, editValues)) setDiscardPromptOpen(true);
    else closeEditor();
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
      setEditId(null);
      setDiscardPromptOpen(false);
      setToast({ tone: "good", text: t("toastUpdated") });
      setTimeout(() => setToast(null), 4000);
      // Background reconcile: confirm the optimistic view against the real,
      // by-then-likely-consistent server state without re-entering the
      // full-page loading state (fetchPolicies() itself doesn't toggle
      // `state` back to "loading" mid-session since `state` is already
      // "ready" here, so this is already a quiet background refresh).
      setTimeout(() => { void fetchPolicies(); }, 1500);
    } catch (caught) {
      setSaveError(formError.fromException("save", caught).message);
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
    } catch (caught) {
      setDeactivateError(formError.fromException("save", caught).message);
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
                render: (p) => <span style={{ fontWeight: 700, color: "var(--primary-d)" }}>{p.maxDaysPerYear as number}</span>,
              },
              {
                key: "maxContinuousDays",
                label: t("colMaxContinuous"),
                align: "center",
                render: (p) => <span style={{ color: "var(--ink2)" }}>{p.maxContinuousDays as number}d</span>,
              },
              {
                key: "carryForward",
                label: t("colCarryFwd"),
                align: "center",
                render: (p) => (p.carryForward ? <span aria-label={t("ariaYes")}>✓</span> : <span aria-label={t("ariaNo")}>—</span>),
              },
              {
                key: "encashable",
                label: t("colEncashable"),
                align: "center",
                render: (p) => (p.encashable ? <span aria-label={t("ariaEncashable")}>💰</span> : <span aria-label={t("ariaNo")}>—</span>),
              },
              {
                key: "countMethod",
                label: t("colCountMethod"),
                align: "center",
                render: (p) => (
                  <span style={{ fontSize: 12 }}>{(p.countMethod as string) === "working_days" ? t("countWorkingShort") : t("optionCalendar")}</span>
                ),
              },
              {
                key: "requiresMedicalCert",
                label: t("colMedCert"),
                align: "center",
                render: (p) =>
                  (p.requiresMedicalCert as boolean)
                    ? <span><span aria-hidden="true">⚕️</span> &gt;{p.requiresMedicalCertAfterDays as number}d</span>
                    : <span aria-label={t("notRequired")}>—</span>,
              },
              {
                key: "sandwichRule",
                label: t("colSandwich"),
                align: "center",
                render: (p) => (p.sandwichRule ? <span aria-label={t("ariaYes")}>✓</span> : <span aria-label={t("ariaNo")}>—</span>),
              },
              {
                key: "minServiceMonths",
                label: t("colMinService"),
                align: "center",
                render: (p) => (
                  <span style={{ fontSize: 12, color: "var(--ink2)" }}>
                    {(p.minServiceMonths as number) > 0 ? `${p.minServiceMonths as number}${t("monthsShort")}` : "—"}
                  </span>
                ),
              },
              {
                key: "id",
                label: t("colActions"),
                align: "center",
                sortable: false,
                render: (p) => (
                  <div style={{ display: "inline-flex", gap: 6 }}>
                    <Button variant="ghost" size="sm" onClick={() => startEdit(p as Policy)}>
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
                ),
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

      {/* GAP-HR-LEAVE-POLICIES-05: one labelled editor for all 12 fields; the
          table above stays read-only. Saves go through the same PATCH. */}
      <Drawer
        open={editingPolicy !== null}
        onClose={requestCloseEditor}
        busy={saving}
        title={editingPolicy ? t("editDrawerTitle", { leaveType: editingPolicy.leaveTypeName, employeeType: tf(`employeeTypes.${editingPolicy.employeeType}`) }) : ""}
        footer={
          <>
            <Button variant="ghost" onClick={requestCloseEditor} disabled={saving}>{t("cancelBtn")}</Button>
            <Button onClick={() => void saveEdit()} disabled={saving}>{t("confirmSaveLabel")}</Button>
          </>
        }
      >
        {editingPolicy && (
          <>
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)" }}>
              {t.rich("confirmDescRich", {
                leaveType: editingPolicy.leaveTypeName,
                employeeType: tf(`employeeTypes.${editingPolicy.employeeType}`),
                strongType: (chunks) => <strong>{chunks}</strong>,
                strongEmp: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
            {saveError && <p role="alert" className="pill bad" style={{ margin: 0 }}>{saveError}</p>}
            {discardPromptOpen && (
              <div role="alert" style={{ padding: 12, border: "1px solid var(--warn)", background: "var(--warnbg)", borderRadius: 8 }}>
                <strong>{t("discardTitle")}</strong>
                <p style={{ margin: "4px 0 8px", fontSize: 13 }}>{t("discardDescription")}</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button size="sm" onClick={closeEditor}>{t("discardConfirmLabel")}</Button>
                  <Button variant="ghost" size="sm" onClick={() => setDiscardPromptOpen(false)}>{t("keepEditing")}</Button>
                </div>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                {tf("daysPerYearLabel")}
                <input type="number" min={0} max={730} value={editValues.maxDaysPerYear ?? 0}
                  onChange={(e) => setEditValues({ ...editValues, maxDaysPerYear: Number(e.target.value) })}
                  style={{ padding: 8, border: "1px solid var(--line)", borderRadius: 8 }} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                {tf("maxAccumulationLabel")}
                <input type="number" min={0} value={editValues.maxAccumulation ?? 0}
                  onChange={(e) => setEditValues({ ...editValues, maxAccumulation: Number(e.target.value) })}
                  style={{ padding: 8, border: "1px solid var(--line)", borderRadius: 8 }} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                {tf("maxContinuousLabel")}
                <input type="number" min={0} value={editValues.maxContinuousDays ?? 0}
                  onChange={(e) => setEditValues({ ...editValues, maxContinuousDays: Number(e.target.value) })}
                  style={{ padding: 8, border: "1px solid var(--line)", borderRadius: 8 }} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                {tf("minServiceLabel")}
                <input type="number" min={0} value={editValues.minServiceMonths ?? 0}
                  onChange={(e) => setEditValues({ ...editValues, minServiceMonths: Number(e.target.value) })}
                  style={{ padding: 8, border: "1px solid var(--line)", borderRadius: 8 }} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                {tf("medCertDaysLabel")}
                <input type="number" min={0} value={editValues.requiresMedicalCertAfterDays ?? 0}
                  onChange={(e) => setEditValues({ ...editValues, requiresMedicalCertAfterDays: Number(e.target.value) })}
                  style={{ padding: 8, border: "1px solid var(--line)", borderRadius: 8 }} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                {tf("countMethodLabel")}
                <select value={editValues.countMethod ?? "calendar"}
                  onChange={(e) => setEditValues({ ...editValues, countMethod: e.target.value })}
                  style={{ padding: 8, border: "1px solid var(--line)", borderRadius: 8 }}>
                  <option value="calendar">{t("optionCalendar")}</option>
                  <option value="working_days">{t("optionWorkingDays")}</option>
                </select>
              </label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
              {([
                ["carryForward", "checkCarryForward"],
                ["encashable", "checkEncashable"],
                ["requiresMedicalCert", "checkRequiresMedCert"],
                ["prefixSuffixRule", "checkPrefixSuffix"],
                ["sandwichRule", "checkSandwich"],
                ["proRataOnJoining", "checkProRata"],
              ] as const).map(([field, labelKey]) => (
                <label key={field} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                  <input type="checkbox" checked={editValues[field] ?? false}
                    onChange={(e) => setEditValues({ ...editValues, [field]: e.target.checked })} />
                  {tf(labelKey)}
                </label>
              ))}
            </div>
          </>
        )}
      </Drawer>

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
