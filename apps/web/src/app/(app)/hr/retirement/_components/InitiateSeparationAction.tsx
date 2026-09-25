"use client";

/**
 * InitiateSeparationAction — the missing UI path for
 * PATCH /v1/hrms/employees/:id/separate.
 *
 * HIGH fix: separation (resignation/retirement/termination/VRS/death) had
 * zero reachable UI anywhere, despite the backend already being fully built
 * -- a Zod-validated separationType enum (lifecycle/validators.ts's
 * separateBody) and a gated PATCH route (employee/routes.ts, HR_ROLES-only)
 * that already work. Same shape of gap as PR #1564's WFH/shift-change fix
 * (backend existed, only the UI was missing), but a different sub-pattern:
 * separation is HR-initiated ON BEHALF OF a specific employee (HR_ROLES
 * only -- there is no self-service path), the same shape as this page's
 * sibling Initiate Transfer / Initiate Promotion actions, not the
 * self-service WFH/leave pattern. Deliberately a single-step form calling
 * the one real PATCH .../separate endpoint directly -- unlike Transfer's
 * two-step eOffice-approval wizard, there is no
 * .../separate/submit-approval endpoint or eFile integration for
 * separation anywhere in this codebase, so this does not invent one.
 * ActionButton (this module's own established maker-checker component,
 * per Button.tsx's doc comment: "irreversible confirm-gated actions... use
 * ActionButton") gates the actual submit.
 *
 * Safety note (updated -- see this change's PR description for the full
 * writeup): employee/routes.ts's PATCH .../separate has a real permission
 * check (HR_ROLES) and its separationType enum matches real CCS separation
 * causes with correct gratuity-eligibility handling. The original version of
 * this comment claimed the prefilled (?empId=) path "cannot, by
 * construction" reach an already-exited employee, because it only ever
 * arrives via the employee detail page's Quick Actions card, itself hidden
 * for any non-serving employee -- that claim was FALSE and has been
 * corrected: middleware.ts only checks session validity (no per-employee
 * gating), GET /employees/:id has no status filter, and `EXITED_STATUSES`
 * below only ever filtered the fetched *picker list*, never the prefill
 * branch -- so a direct navigation to /hr/retirement?empId=<exited-id>
 * reached a fully pre-filled, submittable form. Two real fixes now close
 * this: the backend PATCH .../separate route itself now has the same
 * exited-status guard its sibling /confirm route already had
 * (employee/routes.ts -- the actual fix, not just this UI), and
 * `prefillIsExited` below additionally blocks the prefilled form itself
 * from ever rendering for an already-exited employee, showing a clear
 * "already separated" state instead -- using the SAME status the caller
 * (retirement/page.tsx) already fetched server-side, so this needs no
 * extra request. `EXITED_STATUSES` still keeps an already-exited employee
 * out of the picker list too.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ActionButton } from "@/app/_components/ds";
import { useToast } from "@/app/_components/ds/Toast";
import { useFormError } from "@/lib/useFormError";

type EmployeeOption = { id: string; name?: string; fullName?: string; employeeNo?: string; department?: string; status?: string };

const SEPARATION_TYPES = ["resignation", "retirement", "termination", "vrs", "death"] as const;
type SeparationType = (typeof SEPARATION_TYPES)[number];

// Mirrors employee/status.ts's EXITED_STATUSES exactly -- an employee
// already in one of these has left the organisation for good and must
// never be offered for separation again (see the safety note above).
const EXITED_STATUSES = new Set(["terminated", "separated", "retired"]);

export function InitiateSeparationAction({
  prefillEmployeeId,
  prefillEmployeeName,
  prefillEmployeeStatus,
}: {
  prefillEmployeeId?: string;
  prefillEmployeeName?: string;
  prefillEmployeeStatus?: string;
}) {
  const t = useTranslations("initiateSeparation");
  const router = useRouter();
  const { toast } = useToast();
  const formError = useFormError("separation");

  const [open, setOpen] = useState(false);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeesLoaded, setEmployeesLoaded] = useState(false);
  const [employeeId, setEmployeeId] = useState(prefillEmployeeId ?? "");
  const [separationType, setSeparationType] = useState<SeparationType>("resignation");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [lastWorkingDate, setLastWorkingDate] = useState("");
  const [encashmentDays, setEncashmentDays] = useState("0");
  const [remarks, setRemarks] = useState("");

  // Employee picker only loads when open AND there is no prefill -- arriving
  // via ?empId= from the employee detail page already knows exactly who.
  useEffect(() => {
    if (!open || prefillEmployeeId) return;
    const controller = new AbortController();
    fetch("/api/proxy/v1/hrms/employees?limit=500", { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((body: { data?: EmployeeOption[] } | EmployeeOption[]) => {
        const rows = Array.isArray(body) ? body : (body.data ?? []);
        // Safety: never offer an already-exited employee -- see the module
        // doc comment above.
        setEmployees(rows.filter((e) => !EXITED_STATUSES.has((e.status ?? "").toLowerCase())));
        setEmployeesLoaded(true);
      })
      .catch((e) => { if (e.name !== "AbortError") setEmployeesLoaded(true); });
    return () => controller.abort();
  }, [open, prefillEmployeeId]);

  // SEC CRITICAL (status-integrity fix): see the module doc comment above.
  // Must come after every hook above (rules-of-hooks -- this repo now lints
  // that, see PR #1570) but before anything below reads prefillEmployeeId
  // assuming it is still separable.
  const prefillIsExited = !!prefillEmployeeId && EXITED_STATUSES.has((prefillEmployeeStatus ?? "").toLowerCase());
  if (prefillIsExited) {
    return (
      <span
        role="status"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", fontWeight: 600, color: "var(--mut)" }}
      >
        {t("alreadyExitedNotice", { name: prefillEmployeeName ?? prefillEmployeeId ?? "", status: prefillEmployeeStatus ?? "" })}
      </span>
    );
  }

  const reset = () => {
    setEmployeeId(prefillEmployeeId ?? "");
    setSeparationType("resignation");
    setEffectiveDate("");
    setLastWorkingDate("");
    setEncashmentDays("0");
    setRemarks("");
    formError.clear();
  };

  const selectedEmployee = employees.find((e) => e.id === employeeId);
  const selectedName = prefillEmployeeName ?? selectedEmployee?.fullName ?? selectedEmployee?.name ?? employeeId;

  const encashmentDaysNum = Number(encashmentDays);
  const validEncashmentDays = Number.isFinite(encashmentDaysNum) && encashmentDaysNum >= 0;
  // First unmet condition, surfaced as a hint next to the (disabled) submit
  // button -- WCAG: a disabled control with no explanation of why is a real
  // a11y gap in a codebase this deliberate about it elsewhere.
  const validationHint = !employeeId
    ? t("errSelectEmployee")
    : !effectiveDate
    ? t("errEffectiveDate")
    : !validEncashmentDays
    ? t("errEncashmentDays")
    : null;
  const canSubmit = validationHint === null;

  async function doSeparate() {
    const res = await fetch(`/api/proxy/v1/hrms/employees/${employeeId}/separate`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        separationType,
        effectiveDate,
        lastWorkingDate: lastWorkingDate || undefined,
        encashmentDays: encashmentDaysNum,
        remarks: remarks.trim() || undefined,
      }),
    });
    if (!res.ok) {
      const resolved = await formError.fromResponse(res, "save");
      throw new Error(resolved.message);
    }
  }

  return (
    <>
      <Button
        variant={prefillEmployeeId ? "primary" : undefined}
        onClick={() => { if (open) reset(); setOpen((v) => !v); }}
      >
        {open ? t("cancelButton") : t("openButton")}
      </Button>

      {open && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-h">
            <h3>{t("formTitle")}</h3>
          </div>

          <div className="pad" style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
              <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
                <span style={{ fontWeight: 600 }}>{t("fieldEmployee")}</span>
                {prefillEmployeeId ? (
                  <input
                    value={prefillEmployeeName ?? prefillEmployeeId}
                    disabled
                    style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 44, background: "#f9fafb", color: "var(--ink2)" }}
                  />
                ) : (
                  <select
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value)}
                    style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 44 }}
                  >
                    <option value="">{employeesLoaded ? t("selectEmployeePlaceholder") : t("loadingEmployees")}</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {(e.fullName ?? e.name ?? e.id)}{e.employeeNo ? ` (${e.employeeNo})` : ""}{e.department ? ` · ${e.department}` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
                <span style={{ fontWeight: 600 }}>{t("fieldSeparationType")}</span>
                <select
                  value={separationType}
                  onChange={(e) => setSeparationType(e.target.value as SeparationType)}
                  style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 44 }}
                >
                  {SEPARATION_TYPES.map((st) => (
                    <option key={st} value={st}>{t(`separationType_${st}`)}</option>
                  ))}
                </select>
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
                <span style={{ fontWeight: 600 }}>{t("fieldEffectiveDate")}</span>
                <input
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                  style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 44 }}
                />
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
                <span style={{ fontWeight: 600 }}>{t("fieldLastWorkingDate")}</span>
                <input
                  type="date"
                  value={lastWorkingDate}
                  onChange={(e) => setLastWorkingDate(e.target.value)}
                  style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 44 }}
                />
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
                <span style={{ fontWeight: 600 }}>{t("fieldEncashmentDays")}</span>
                <input
                  type="number"
                  min={0}
                  value={encashmentDays}
                  onChange={(e) => setEncashmentDays(e.target.value)}
                  style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 44 }}
                />
              </label>
            </div>

            <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
              <span style={{ fontWeight: 600 }}>{t("fieldRemarks")}</span>
              <textarea
                rows={2}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder={t("remarksPlaceholder")}
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", resize: "vertical" }}
              />
            </label>

            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
              {validationHint && (
                <span role="status" style={{ fontSize: "0.75rem", color: "var(--mut)" }}>{validationHint}</span>
              )}
              <Button variant="ghost" onClick={() => { reset(); setOpen(false); }}>{t("cancelButton")}</Button>
              <ActionButton
                label={t("submitButton")}
                disabled={!canSubmit}
                danger
                confirmTitle={t("confirmTitle")}
                confirmDescription={t("confirmDescription", { name: selectedName, type: t(`separationType_${separationType}`), date: effectiveDate })}
                confirmLabel={t("confirmButton")}
                onConfirm={() => doSeparate()}
                onSuccess={() => {
                  toast.success(t("toastSuccess", { name: selectedName }));
                  reset();
                  setOpen(false);
                  router.refresh();
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
