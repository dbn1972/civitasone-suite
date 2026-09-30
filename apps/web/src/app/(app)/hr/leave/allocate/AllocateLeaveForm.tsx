"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { fiscalYearLabel, financialYearOf } from "@/lib/fiscalYear";
import { Button, ConfirmDialog, EntityPicker } from "../../../../_components/ds";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";

type LeaveTypeOption = { id: string; code: string; name: string };
type ContextAlloc = { id: string; leaveTypeId: string; leaveTypeCode: string; leaveTypeName: string; fy: string; totalDays: number; balanceDays: number };
type LeaveContext = { leaveTypes: Array<{ id: string; code: string; name: string; maxDays: number }>; allocations: ContextAlloc[] };

const inputStyle: CSSProperties = {
  width: "100%", padding: "8px 12px", border: "1px solid var(--line)",
  borderRadius: 8, background: "var(--bg2)", color: "var(--ink)", fontSize: 14,
};
const inputErrStyle: CSSProperties = { ...inputStyle, border: "1px solid var(--badbd, #ef4444)" };
const fieldErrStyle: CSSProperties = { color: "var(--bad, #b91c1c)", fontSize: 12, margin: "3px 0 0" };

/**
 * GAP-HR-LEAVE-ALLOCATE-05: three real FYs (current-1/current/current+1),
 * IST-resolved via financialYearOf, replacing the free-text input a bare
 * /^\d{4}-\d{2}$/ regex validated (accepted '2026-99'). Local getCurrentFY
 * (naive process-timezone month math) removed in favour of the shared,
 * IST-aware helper.
 */
function fyOptions(): string[] {
  const currentStart = Number(financialYearOf(new Date()).slice(0, 4));
  return [currentStart - 1, currentStart, currentStart + 1].map(fiscalYearLabel);
}

export function AllocateLeaveForm() {
  const t = useTranslations("leaveAllocate");
  const router = useRouter();
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeOption[]>([]);
  // GAP-HR-LEAVE-ALLOCATE-01: no default selection — was silently
  // preselected to empRows[0]/ltRows[0] (an HR clerk who only typed a day
  // count would allocate to whichever employee/type happened to sort
  // first). null = nothing chosen yet.
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const fyChoices = useMemo(fyOptions, []);
  const [fy, setFy] = useState(fyChoices[1]!); // current FY
  const [totalDays, setTotalDays] = useState("");
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Shown INSIDE the still-open ConfirmDialog on a failed submit (same
  // pattern as LeavePoliciesClient's saveError) — `message` above renders
  // above the form itself, which is hidden behind the dialog overlay while
  // it's open, so a submit failure must surface here instead or the user
  // never sees it.
  const [submitError, setSubmitError] = useState<string | undefined>();
  const formError = useFormError("leave allocation");

  // GAP-HR-LEAVE-ALLOCATE-03: the chosen employee's existing allocations —
  // shown so a clerk isn't allocating blind — plus the selected leave
  // type's policy maxDays, for a soft (non-blocking) over-cap warning.
  const [context, setContext] = useState<LeaveContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);

  const empId = useId();
  const ltId = useId();
  const fyId = useId();
  const daysId = useId();

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/proxy/v1/hrms/leave-types", { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((ltBody: unknown) => {
        const arr = Array.isArray(ltBody) ? ltBody : ((ltBody as { data?: LeaveTypeOption[] })?.data ?? []);
        setLeaveTypes(arr);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setStatus("error");
        setMessage(t("loadOptionsError"));
      });
    return () => controller.abort();
  }, [t]);

  // GAP-HR-LEAVE-ALLOCATE-03: fetch the chosen employee's leave context
  // (existing allocations + policy maxDays) whenever the employee changes.
  // Read-only, IDOR-guarded on the backend (context-routes.ts) same as
  // every other caller of this endpoint.
  useEffect(() => {
    if (!employeeId) { setContext(null); return; }
    const controller = new AbortController();
    setContextLoading(true);
    fetch(`/api/proxy/v1/hrms/leave-context?employeeId=${employeeId}`, { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((body: LeaveContext) => setContext(body))
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setContext(null);
      })
      .finally(() => setContextLoading(false));
    return () => controller.abort();
  }, [employeeId]);

  function clearErr(field: string) {
    setInvalid((s) => { const n = new Set(s); n.delete(field); return n; });
  }

  function validate(): boolean {
    const errs = new Set<string>();
    if (!employeeId) errs.add("employee");
    if (!leaveTypeId) errs.add("leaveType");
    const days = parseInt(totalDays, 10);
    if (!totalDays || isNaN(days) || days <= 0 || days > 365) errs.add("days");
    setInvalid(errs);
    return errs.size === 0;
  }

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setMessage("");
    setSubmitError(undefined);
    setConfirmOpen(true);
  }

  async function submitAllocation() {
    setStatus("submitting");
    setSubmitError(undefined);
    const days = parseInt(totalDays, 10);
    try {
      const res = await fetch("/api/proxy/v1/hrms/leave-allocations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ employeeId, leaveTypeId, fy, totalDays: days }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setStatus("error");
        setSubmitError(resolved.message);
        return;
      }
      setConfirmOpen(false);
      setStatus("success");
      setMessage(t("allocationSuccess"));
      // GAP-HR-LEAVE-ALLOCATE-05: reset employeeId too, not just totalDays —
      // a repeat allocation used to be one number away with everything else
      // still selected.
      setTotalDays("");
      setEmployeeId(null);
    } catch {
      setStatus("error");
      setSubmitError(formError.fromException("save").message);
    }
  }

  const selectedLeaveType = leaveTypes.find((lt) => lt.id === leaveTypeId);
  const selectedTypeMaxDays = context?.leaveTypes.find((lt) => lt.id === leaveTypeId)?.maxDays ?? 0;
  const daysNum = parseInt(totalDays, 10);
  const overCap = selectedTypeMaxDays > 0 && !isNaN(daysNum) && daysNum > selectedTypeMaxDays;

  return (
    <>
      <form onSubmit={openConfirm} noValidate style={{ display: "grid", gap: 14 }}>
        {message && (
          <p role={status === "error" ? "alert" : "status"} aria-live={status === "error" ? "assertive" : "polite"}
            className={`pill ${status === "error" ? "bad" : "good"}`} style={{ margin: 0 }}>
            {message}
          </p>
        )}

        <div>
          <label htmlFor={empId} style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 4 }}>
            {t("employeeLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #ef4444)" }}>*</span>
          </label>
          {/* GAP-HR-LEAVE-ALLOCATE-04: EntityPicker (GAP-HR-SF-06) replaces a
              <select> that fetched up to 500 employees in one uncached call
              with a debounced, cancellable, server-side search. */}
          <EntityPicker
            id={empId}
            value={employeeId}
            onChange={(v) => { setEmployeeId(Array.isArray(v) ? (v[0] ?? null) : v); clearErr("employee"); }}
            search={searchEmployees}
            resolve={resolveEmployees}
            placeholder={t("employeeSearchPlaceholder")}
          />
          {invalid.has("employee") && (
            <p id={`${empId}-err`} role="alert" style={fieldErrStyle}>{t("employeeRequired")}</p>
          )}
        </div>

        {employeeId && (
          <div style={{ padding: "10px 12px", background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12 }}>
            {contextLoading ? (
              <span style={{ color: "var(--mut)" }}>{t("loadingContext")}</span>
            ) : context && context.allocations.length > 0 ? (
              <>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{t("existingAllocationsTitle")}</div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--mut)" }}>
                      <th style={{ fontWeight: 500, padding: "2px 6px 2px 0" }}>{t("contextColType")}</th>
                      <th style={{ fontWeight: 500, padding: "2px 6px" }}>{t("contextColFy")}</th>
                      <th style={{ fontWeight: 500, padding: "2px 6px", textAlign: "right" }}>{t("contextColTotal")}</th>
                      <th style={{ fontWeight: 500, padding: "2px 0 2px 6px", textAlign: "right" }}>{t("contextColBalance")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {context.allocations.map((a) => (
                      <tr key={a.id} style={a.leaveTypeId === leaveTypeId && a.fy === fy ? { fontWeight: 700 } : undefined}>
                        <td style={{ padding: "2px 6px 2px 0" }}>{a.leaveTypeCode}</td>
                        <td style={{ padding: "2px 6px" }}>{a.fy}</td>
                        <td style={{ padding: "2px 6px", textAlign: "right" }}>{a.totalDays}</td>
                        <td style={{ padding: "2px 0 2px 6px", textAlign: "right" }}>{a.balanceDays}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <span style={{ color: "var(--mut)" }}>{t("noExistingAllocations")}</span>
            )}
            {/* Deep-link preselect (?empId=) lands on GAP-HR-LEAVE-BALANCE-02's
                own page changes — until that merges this link still opens the
                balance page, just without preselecting the employee yet. */}
            <div style={{ marginTop: 6 }}>
              <Link href={`/hr/leave/balance?empId=${employeeId}`} style={{ color: "var(--primary-d)" }}>
                {t("viewFullBalanceLink")}
              </Link>
            </div>
          </div>
        )}

        <div>
          <label htmlFor={ltId} style={{ fontSize: 13, fontWeight: 500 }}>
            {t("leaveTypeLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #ef4444)" }}>*</span>
          </label>
          <select
            id={ltId}
            value={leaveTypeId}
            onChange={(e) => { setLeaveTypeId(e.target.value); clearErr("leaveType"); }}
            style={invalid.has("leaveType") ? inputErrStyle : inputStyle}
            aria-invalid={invalid.has("leaveType")}
            aria-describedby={invalid.has("leaveType") ? `${ltId}-err` : undefined}
          >
            <option value="">{leaveTypes.length === 0 ? (status === "error" ? t("unableToLoadLeaveTypes") : t("loadingOption")) : t("selectLeaveTypePlaceholder")}</option>
            {leaveTypes.map((lt) => (
              <option key={lt.id} value={lt.id}>{lt.name} ({lt.code})</option>
            ))}
          </select>
          {invalid.has("leaveType") && (
            <p id={`${ltId}-err`} role="alert" style={fieldErrStyle}>{t("leaveTypeRequired")}</p>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <label htmlFor={fyId} style={{ fontSize: 13, fontWeight: 500 }}>
              {t("financialYearLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #ef4444)" }}>*</span>
            </label>
            <select
              id={fyId}
              value={fy}
              onChange={(e) => setFy(e.target.value)}
              style={inputStyle}
            >
              {fyChoices.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={daysId} style={{ fontSize: 13, fontWeight: 500 }}>
              {t("totalDaysLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #ef4444)" }}>*</span>
            </label>
            <input
              id={daysId}
              type="number"
              min={1}
              max={365}
              value={totalDays}
              onChange={(e) => { setTotalDays(e.target.value); clearErr("days"); }}
              placeholder={t("daysPlaceholder")}
              style={invalid.has("days") ? inputErrStyle : inputStyle}
              aria-invalid={invalid.has("days")}
              aria-describedby={invalid.has("days") ? `${daysId}-err` : overCap ? `${daysId}-cap-warn` : undefined}
            />
            {invalid.has("days") && (
              <p id={`${daysId}-err`} role="alert" style={fieldErrStyle}>{t("daysRangeError")}</p>
            )}
            {!invalid.has("days") && overCap && (
              <p id={`${daysId}-cap-warn`} role="status" style={{ color: "var(--warn-d, #92620a)", fontSize: 12, margin: "3px 0 0" }}>
                {t("overCapWarning", { maxDays: selectedTypeMaxDays, typeName: selectedLeaveType?.name ?? "" })}
              </p>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <Button type="submit" disabled={status === "submitting"} style={{ minHeight: 44, minWidth: 140 }}>
            {t("submitLabel")}
          </Button>
          <Button type="button" variant="ghost" style={{ minHeight: 44 }} onClick={() => router.push("/hr/leave")}>
            {t("cancel")}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmAllocateTitle")}
        confirmLabel={t("confirmAllocateLabel")}
        busy={status === "submitting"}
        errorMessage={submitError}
        description={t("confirmAllocateDescription", {
          days: totalDays,
          typeName: selectedLeaveType?.name ?? "",
          fy,
        })}
        onConfirm={() => void submitAllocation()}
        onCancel={() => { if (status !== "submitting") { setConfirmOpen(false); setSubmitError(undefined); } }}
      />
    </>
  );
}
