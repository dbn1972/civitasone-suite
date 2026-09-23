"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PageHeader, Card, DataTable, EmptyState, ConfirmDialog, StatGrid, StatCard, Button } from "../../../_components/ds";
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
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setSaveError(resolved.message);
        return;
      }
      setConfirmOpen(false);
      setEditId(null);
      setToast({ tone: "good", text: t("toastUpdated") });
      await fetchPolicies();
      setTimeout(() => setToast(null), 4000);
    } catch {
      setSaveError(formError.fromException("save").message);
    } finally {
      setSaving(false);
    }
  }

  async function handlePolicyCreated() {
    setToast({ tone: "good", text: t("toastCreated") });
    await fetchPolicies();
    setTimeout(() => setToast(null), 4000);
  }

  const editingPolicy = policies.find((p) => p.id === editId) ?? null;
  const rows: PolicyRow[] = policies as PolicyRow[];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
      />
      <DataSourceBadge source={state === "error" ? "error" : "api"} />
      {state === "ready" && policies.length > 0 && (
        <StatGrid>
          <StatCard icon="📋" iconBg="#e6f0ff" label={t("statTotal")} value={policies.length} />
          <StatCard icon="✅"       iconBg="#e6f7f0" label={t("statActive")} value={policies.filter((p) => p.isActive).length} />
          <StatCard icon="🔁" iconBg="#fff7e6" label={t("statCarryForward")} value={policies.filter((p) => p.carryForward).length} />
          <StatCard icon="💰" iconBg="#f5f5f5" label={t("statEncashable")} value={policies.filter((p) => p.encashable).length} />
        </StatGrid>
      )}

      <div role="group" aria-label={t("filterGroupLabel")} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {[{ value: "all", label: t("allTypes") }, ...EMPLOYEE_TYPES.map((type) => ({ value: type, label: type.replace("_", " ") }))].map((o) => (
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
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--mut)" }} aria-live="polite">
            {t("loadingPolicies")}
          </div>
        ) : state === "error" ? (
          <EmptyState
            icon="⚠️"
            title={t("errorTitle")}
            message={loadError ?? t("errorFallback")}
            action={
              <Button variant="ghost" onClick={() => void fetchPolicies()}>
                {t("retry")}
              </Button>
            }
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
                  <span className={`pill ${TYPE_VARIANT[p.employeeType as string] ?? "mut"}`} style={{ textTransform: "capitalize" }}>
                    {(p.employeeType as string).replace("_", " ")}
                  </span>
                ),
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
                    <Button variant="ghost" size="sm" onClick={() => startEdit(p as Policy)}>
                      {t("editBtn")}
                    </Button>
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
              employeeType: editingPolicy.employeeType.replace("_", " "),
              strongType: (chunks) => <strong>{chunks}</strong>,
              strongEmp: (chunks) => <strong style={{ textTransform: "capitalize" }}>{chunks}</strong>,
            })
          ) : (
            t("confirmDescDefault")
          )
        }
        onConfirm={() => void saveEdit()}
        onCancel={() => !saving && setConfirmOpen(false)}
      />
    </main>
  );
}
