"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog, EntityPicker, Field, Input, Select } from "../../../../_components/ds";
import { browserFetch, errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";
import { parseAllocationPct, validateAllocationDates, type CostCenterOption, type ProjectOption } from "./projectCostingShared";

type Props = {
  projects: ProjectOption[];
  costCenters: CostCenterOption[];
  /** False while the tenant has not switched project costing on: the form explains instead of failing. */
  enabled: boolean;
};

type Target = "project" | "cost_center";

/**
 * Request an effective-dated cost allocation of one employee to a project or a
 * cost centre (S8 G7). The request is maker-checker: someone else approves it
 * on this page. Every field has a visible label, errors are announced
 * (role="alert") and focus moves to the first invalid field.
 */
export function AllocationForm({ projects, costCenters, enabled }: Props) {
  const t = useTranslations("projectCosting");
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [target, setTarget] = useState<Target>("project");
  const [projectId, setProjectId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [pct, setPct] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});

  const ids = { emp: useId(), target: useId(), project: useId(), cc: useId(), pct: useId(), from: useId(), to: useId(), note: useId() };
  const projectRef = useRef<HTMLSelectElement>(null);
  const ccRef = useRef<HTMLSelectElement>(null);
  const pctRef = useRef<HTMLInputElement>(null);
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);

  const project = projects.find((p) => p.projectId === projectId);
  const split = parseAllocationPct(pct);
  const resolvedCostCenter = target === "project" ? project?.costCenterId ?? "" : costCenterId;
  const ccLabel = (id: string) => { const c = costCenters.find((x) => x.id === id); return c ? `${c.code} — ${c.name}` : id; };

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setMessage(null);
    const next: Record<string, boolean> = {};
    let msg: string | undefined;
    let focus: HTMLElement | null = null;
    const flag = (k: string, m: string, el: HTMLElement | null) => { next[k] = true; msg ??= m; focus ??= el; };
    if (!employeeId) flag("emp", t("employeeRequiredError"), null);
    if (target === "project" && !project) flag("project", t("projectRequiredError"), projectRef.current);
    else if (target === "project" && !project?.costCenterId) flag("project", t("projectNoCostCenterError"), projectRef.current);
    if (target === "cost_center" && !costCenterId) flag("cc", t("costCenterRequiredError"), ccRef.current);
    if (split === null) flag("pct", t("pctRangeError"), pctRef.current);
    const dateKey = validateAllocationDates(from, to);
    if (dateKey) flag(dateKey === "toBeforeFromError" ? "to" : "from", t(dateKey), dateKey === "toBeforeFromError" ? toRef.current : fromRef.current);
    setInvalid(next);
    if (msg) { setError(msg); (focus as HTMLElement | null)?.focus(); return; }
    setConfirmOpen(true);
  }

  async function save() {
    if (!employeeId || split === null || !resolvedCostCenter) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await browserFetch("v1/payroll/project-costing/allocations", {
        method: "POST",
        body: JSON.stringify({
          employeeId, targetType: target, ...(target === "project" ? { projectId } : {}),
          costCenterId: resolvedCostCenter, splitPct: split, effectiveFrom: from, ...(to ? { effectiveTo: to } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const code = await errorCodeFromResponse(res);
        if (code === "ALLOCATION_EXCEEDS_100") throw new Error(t("serverOver100Error"));
        if (code === "PROJECT_COSTING_DISABLED") throw new Error(t("disabledError"));
        throw new Error(await errorMessageFromResponse(res));
      }
      setConfirmOpen(false);
      setMessage(t("requestedMessage"));
      setEmployeeId(null); setProjectId(""); setCostCenterId(""); setPct(""); setFrom(""); setTo(""); setNote("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={openConfirm} noValidate style={{ marginBottom: 16 }}>
      <Card title={t("formTitle")} padding>
        {!enabled && <p role="status" className="pill warn" style={{ width: "fit-content", marginTop: 0 }}>{t("notEnabledNotice")}</p>}
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
          <Field id={ids.emp} label={t("employeeLabel")} required error={invalid.emp ? t("employeeRequiredError") : undefined}>
            <EntityPicker
              value={employeeId}
              onChange={(v) => { setEmployeeId(Array.isArray(v) ? (v[0] ?? null) : v); setInvalid((s) => ({ ...s, emp: false })); }}
              search={searchEmployees}
              resolve={resolveEmployees}
              minQueryLength={2}
              placeholder={t("employeePlaceholder")}
            />
          </Field>
          <Field id={ids.target} label={t("targetLabel")} required>
            <Select value={target} onChange={(e) => { setTarget(e.target.value as Target); setInvalid({}); }}>
              <option value="project">{t("targetProject")}</option>
              <option value="cost_center">{t("targetCostCenter")}</option>
            </Select>
          </Field>
          {target === "project" ? (
            <Field id={ids.project} label={t("projectLabel")} required error={invalid.project ? t("projectRequiredError") : undefined}>
              <Select ref={projectRef} value={projectId} onChange={(e) => { setProjectId(e.target.value); setInvalid((s) => ({ ...s, project: false })); }}>
                <option value="">{t("projectPlaceholder")}</option>
                {projects.map((p) => (
                  <option key={p.projectId} value={p.projectId}>{`${p.code} — ${p.name}${p.costCenterId ? "" : ` (${t("noCostCenterTag")})`}`}</option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field id={ids.cc} label={t("costCenterLabel")} required error={invalid.cc ? t("costCenterRequiredError") : undefined}>
              <Select ref={ccRef} value={costCenterId} onChange={(e) => { setCostCenterId(e.target.value); setInvalid((s) => ({ ...s, cc: false })); }}>
                <option value="">{t("costCenterPlaceholder")}</option>
                {costCenters.map((c) => <option key={c.id} value={c.id}>{`${c.code} — ${c.name}`}</option>)}
              </Select>
            </Field>
          )}
          <Field id={ids.pct} label={t("pctLabel")} required error={invalid.pct ? t("pctRangeError") : undefined}>
            <Input ref={pctRef} type="number" inputMode="decimal" min={0.01} max={100} step={0.01} value={pct}
              onChange={(e) => { setPct(e.target.value); setInvalid((s) => ({ ...s, pct: false })); }} />
          </Field>
          <Field id={ids.from} label={t("fromLabel")} required error={invalid.from ? t("dateInvalidError") : undefined}>
            <Input ref={fromRef} type="date" value={from} onChange={(e) => { setFrom(e.target.value); setInvalid((s) => ({ ...s, from: false })); }} />
          </Field>
          <Field id={ids.to} label={t("toLabel")} error={invalid.to ? t("toBeforeFromError") : undefined}>
            <Input ref={toRef} type="date" value={to} onChange={(e) => { setTo(e.target.value); setInvalid((s) => ({ ...s, to: false })); }} />
          </Field>
          <Field id={ids.note} label={t("noteLabel")}>
            <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <p style={{ margin: "10px 0 0", fontSize: "0.85rem", color: "var(--ink2)" }}>{t("formHint")}</p>
        <div style={{ marginTop: 14 }}>
          <Button type="submit" style={{ minHeight: 44 }} disabled={busy || !enabled}>{t("requestBtn")}</Button>
        </div>
        {error && !confirmOpen && <p role="alert" className="pill bad" style={{ marginTop: 10, width: "fit-content" }}>{error}</p>}
        {message && <p role="status" className="pill good" style={{ marginTop: 10, width: "fit-content" }}>{message}</p>}
      </Card>
      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={error}
        description={t.rich("confirmDescription", {
          pct: split ?? pct, target: target === "project" ? `${project?.code ?? ""} ${project?.name ?? ""}`.trim() : ccLabel(costCenterId),
          from, strong: (chunks) => <strong>{chunks}</strong>,
        })}
        onConfirm={() => void save()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
