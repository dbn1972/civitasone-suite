"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EmployeeSummary } from "@civitasone/types";
import { fetchOrQueue } from "@/lib/sync/requestQueue";
import { trackActivation } from "@/lib/activation";
import { useToast } from "@/app/_components/ds/Toast";
import { ConfirmDialog, EntityPicker, Field, Input, Select, Textarea } from "@/app/_components/ds";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";
import { useTranslations } from "next-intl";
import {
  useFieldValidation,
  required,
  minLength,
  type Validator,
} from "@/lib/form-validation";
import { useFormError } from "@/lib/useFormError";
import {
  availableDayParts, daysForPart, parseLeaveConfig, NO_PART_DAY_CONFIG,
  type LeaveDayPart, type LeaveTenantConfig,
} from "./dayPart";

type LeaveAllocation = {
  id: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  balanceDays: number;
};

type LeaveContext = {
  employee: { id: string; employeeNo: string; name: string };
  leaveTypes: Array<{ id: string; code: string; name: string; maxDays: number }>;
  allocations: LeaveAllocation[];
};

type Props = {
  employees: EmployeeSummary[];
  /** Preselects this employee when arriving via a deep link (e.g. an employee
   *  profile's "Apply Leave" quick action, ?empId=...). Falls back to the
   *  first employee in the list if not provided or not found in it. */
  initialEmployeeId?: string;
  /** The current user's own employee id, when it appears in `employees` (an
   *  HR admin/manager viewing the full roster) — used as the default
   *  selection instead of an arbitrary first row, and to label that option
   *  and show an "applying on behalf of" note for every other one. */
  myEmployeeId?: string;
  /** True when the logged-in user has no linked employee record at all — a
   *  normal 404 from the self-service profile endpoint, not a fetch failure
   *  — and (being a plain `employee`) no admin-picker access either. There
   *  is nothing this form can do for them yet, so it shows a clear, honest
   *  message instead of a confusing empty "no employees loaded" dropdown. */
  noLinkedProfile?: boolean;
};

export function ApplyLeaveForm({ employees, initialEmployeeId, myEmployeeId, noLinkedProfile }: Props) {
  const t = useTranslations("leaveApply");
  // GAP-HR-LEAVE-APPLY-03: an ?empId= deep link still wins outright. Absent
  // that, this used to fall back to employees[0] — an arbitrary employee an
  // unordered fetch happened to return first. When the current user's own
  // employee record is IN this list (an HR admin/manager viewing the full
  // roster, not the single-row self-service fallback below), default to
  // "myself" instead — the common case (an HR admin applying for their own
  // leave) no longer requires finding themselves in a long list first.
  // GAP-HR-LEAVE-ALLOCATE-04: with more than one employee to choose from (HR /
  // manager), the control is a type-ahead picker over the whole directory, not
  // a <select> of whatever first page the server happened to send. The
  // single-row self-service case keeps the plain select: there is nobody else
  // to find.
  const pickerMode = employees.length > 1;
  const preselected = initialEmployeeId && employees.some((e) => e.id === initialEmployeeId)
    ? initialEmployeeId
    : (myEmployeeId && employees.some((e) => e.id === myEmployeeId) ? myEmployeeId : employees[0]?.id ?? "");
  const [employeeId, setEmployeeId] = useState(preselected);
  // An ?empId= deep link to someone beyond the server-sent page is honoured too,
  // but only once the directory confirms that person exists and is visible to
  // this viewer -- a bogus or out-of-scope id leaves the normal default in place
  // instead of loading a context for a stranger. Mount-time only.
  useEffect(() => {
    if (!pickerMode || !initialEmployeeId || employees.some((e) => e.id === initialEmployeeId)) return;
    let cancelled = false;
    resolveEmployees([initialEmployeeId])
      .then((opts) => { if (!cancelled && opts.some((o) => o.id === initialEmployeeId)) setEmployeeId(initialEmployeeId); })
      .catch(() => undefined);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Label of the picked person when they are not in the server-sent `employees`
  // list (found by search / deep link), for the "applying on behalf of" note.
  const [pickedLabel, setPickedLabel] = useState("");
  useEffect(() => {
    if (!pickerMode || !employeeId || employees.some((e) => e.id === employeeId)) { setPickedLabel(""); return; }
    let cancelled = false;
    resolveEmployees([employeeId])
      .then((opts) => { if (!cancelled) setPickedLabel(opts[0]?.label ?? ""); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [pickerMode, employeeId, employees]);
  const [leaveContext, setLeaveContext] = useState<LeaveContext | null>(null);
  const [status, setStatus] = useState<
    "idle" | "loading" | "submitting" | "accepted" | "error"
  >("idle");
  const [message, setMessage] = useState("");
  const { toast } = useToast();
  const formError = useFormError("leave request");

  // GAP-HR-LEAVE-APPLY-01: server-confirmed preview of what a submit would
  // actually debit (POST .../leave-requests/preview — reuses the exact same
  // enforceCcsLeaveRules the real submit calls, so these can never diverge).
  // null = not yet checked, or the preview request itself couldn't be
  // reached (offline) — falls back to the old approximate calendar count,
  // not a hard block. A thrown 4xx (rule violation / insufficient balance)
  // sets previewError instead, which DOES block submit inline (GAP-HR-
  // LEAVE-APPLY-04) — no more window.confirm('...Continue?').
  const [preview, setPreview] = useState<{ computedDays: number; engineApplied: boolean } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewChecking, setPreviewChecking] = useState(false);
  // Soft confirm for the offline/preview-unavailable fallback path only —
  // GAP-HR-LEAVE-APPLY-04 fix step 2: "If a warning-only path is still
  // needed (offline/queued), use ds ConfirmDialog ... instead of
  // window.confirm."
  const [offlineConfirmOpen, setOfflineConfirmOpen] = useState(false);

  // GAP-HR-LEAVE-APPLY-05: per-tenant half-day / short-leave switch. Defaults
  // to OFF and stays OFF if the config can't be read, so a tenant that never
  // enabled it (or an unreachable endpoint) sees exactly the whole-day form.
  const initialLeaveConfig: LeaveTenantConfig = NO_PART_DAY_CONFIG;
  const [leaveConfig, setLeaveConfig] = useState(initialLeaveConfig);
  const [dayPart, setDayPart] = useState("full" as LeaveDayPart);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/proxy/v1/hrms/leave-config", { signal: controller.signal })
      .then(async (res) => (res.ok ? setLeaveConfig(parseLeaveConfig(await res.json())) : undefined))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  // Ref that mirrors fromDate value for the cross-field toDate validator.
  // Updated during render (write-to-ref-during-render pattern — safe in React).
  const fromDateRef = useRef("");

  // Cross-field toDate validator — reads fromDateRef synchronously at call time.
  const toDateAfterFrom: Validator = useCallback(
    (v) => {
      if (!v || !fromDateRef.current) return undefined;
      return new Date(v) < new Date(fromDateRef.current)
        ? t("toDateAfterFromError")
        : undefined;
    },
    [t],
  );

  const { fields, validate, values, reset: resetFields } = useFieldValidation({
    allocId: [required()],
    fromDate: [required()],
    toDate: [required(), toDateAfterFrom],
    reason: [required(), minLength(20)],
  });

  // Keep fromDateRef current so the toDate validator sees the latest value.
  fromDateRef.current = values.fromDate;

  const loadContext = useCallback(async (empId: string, signal?: AbortSignal) => {
    if (!empId) {
      setLeaveContext(null);
      return;
    }
    setStatus("loading");
    try {
      const res = await fetch(
        `/api/proxy/v1/hrms/leave-context?employeeId=${encodeURIComponent(empId)}`,
        { signal },
      );
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "load");
        throw UserFacingError.from(resolved);
      }
      const ctx = (await res.json()) as LeaveContext;
      setLeaveContext(ctx);
      setStatus("idle");
    } catch (err) {
      // An abort means either this component unmounted, or (just as real a
      // risk here, since this effect re-fires on every employeeId change) a
      // newer load for a *different* employeeId has already superseded this
      // one -- either way, painting this stale attempt's error state would
      // be wrong, possibly showing "failed to load" over a context that
      // actually loaded fine a moment later, or vice versa.
      if (err instanceof Error && err.name === "AbortError") return;
      setLeaveContext(null);
      setStatus("error");
      setMessage(
        formError.fromException("load", err).message,
      );
    }
    // formError.fromResponse/fromException are stable across renders (see
    // useFormError) even though the wrapping object literal isn't.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- formError.fromResponse/fromException/clear are stable (useCallback'd on a fixed area string in useFormError); the wrapping object is recreated every render but isn't read here.
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadContext(employeeId, controller.signal);
    return () => controller.abort();
  }, [employeeId, loadContext]);

  // When employee changes, reset validation state too.
  useEffect(() => {
    resetFields();
  }, [employeeId, resetFields]);

  const selectedAlloc = leaveContext?.allocations.find(
    (a) => a.id === values.allocId,
  );

  function calendarSpan(): number {
    if (!values.fromDate || !values.toDate) return 0;
    const from = new Date(values.fromDate);
    const to = new Date(values.toDate);
    if (to < from) return 0;
    return Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  }

  // The offered duration choices (full day always; halves/short only for CL on
  // a single date when the tenant enabled them). A chosen part that stops being
  // offered (date range widened, other leave type picked) falls back to full.
  const dayParts = availableDayParts(leaveConfig, selectedAlloc?.leaveTypeCode, calendarSpan() === 1);
  const effectiveDayPart: LeaveDayPart = dayParts.includes(dayPart) ? dayPart : "full";

  function calcDays(): number {
    return daysForPart(effectiveDayPart, calendarSpan());
  }

  // GAP-HR-LEAVE-APPLY-01: debounced server preview whenever the three
  // fields it needs are all present. Deliberately does NOT fire on
  // `employeeId` changes alone — it's keyed on the same values.* the submit
  // body uses, so it never previews a stale employee/allocation pairing.
  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    if (!selectedAlloc || !values.fromDate || !values.toDate || calcDays() <= 0) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setPreviewChecking(true);
      fetch("/api/proxy/v1/hrms/leave-requests/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          employeeId,
          leaveTypeId: selectedAlloc.leaveTypeId,
          allocId: selectedAlloc.id,
          fromDate: values.fromDate,
          toDate: values.toDate,
          daysApplied: calcDays(),
          dayPart: effectiveDayPart,
        }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const resolved = await formError.fromResponse(res, "load");
            setPreviewError(resolved.message);
            return;
          }
          setPreview(await res.json());
        })
        .catch((err) => {
          // Offline/unreachable: leave preview null (falls back to the
          // approximate calendar count below) rather than blocking on it —
          // NOT a validation failure, just no signal either way.
          if (err instanceof Error && err.name === "AbortError") return;
        })
        .finally(() => setPreviewChecking(false));
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedAlloc is derived from values.allocId + leaveContext (already deps below); formError is stable (see loadContext's own note above).
  }, [employeeId, values.allocId, values.fromDate, values.toDate, selectedAlloc, effectiveDayPart]);

  async function submitAllocation(daysApplied: number) {
    if (!selectedAlloc) return;
    setStatus("submitting");
    setMessage("");

    const body = {
      employeeId,
      leaveTypeId: selectedAlloc.leaveTypeId,
      allocId: values.allocId,
      fromDate: values.fromDate,
      toDate: values.toDate,
      daysApplied,
      dayPart: effectiveDayPart,
      reason: values.reason.trim(),
    };

    try {
      const { response, queued } = await fetchOrQueue(
        "/v1/hrms/leave-requests",
        { method: "POST", body },
      );

      if (queued) {
        setStatus("accepted");
        setMessage(t("queuedMessage"));
        toast.info(t("queuedToast"));
        resetFields();
        return;
      }

      if (!response || !response.ok) {
        const resolved = response
          ? await formError.fromResponse(response, "save")
          : formError.fromException("save", new TypeError("no response"));
        setStatus("error");
        setMessage(resolved.message);
        toast.error(resolved.message);
        return;
      }
      setStatus("accepted");
      trackActivation("first_transaction");
      setMessage(t("acceptedMessage"));
      toast.success(t("acceptedMessage"));
      resetFields();
      void loadContext(employeeId);
    } catch (caught) {
      setStatus("error");
      setMessage(formError.fromException("save", caught).message);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Run all validators; if any fail, abort.
    if (!validate()) {
      setStatus("error");
      setMessage(t("fixErrorsError"));
      return;
    }

    if (!selectedAlloc) {
      setStatus("error");
      setMessage(t("selectValidLeaveTypeError"));
      return;
    }

    const calendarDays = calcDays();
    if (calendarDays <= 0) {
      setStatus("error");
      setMessage(t("toDateAfterFromError"));
      return;
    }

    // GAP-HR-LEAVE-APPLY-01/04: a successful preview already ran the same
    // rules engine + IDOR + eligibility + overlap checks the real submit
    // would — if it came back clean, submit is safe to fire immediately
    // with the SERVER-confirmed day count, no further confirmation needed.
    // previewError means preview itself caught a real problem: block here,
    // inline, instead of a native confirm() the user could click through.
    if (previewError) {
      setStatus("error");
      setMessage(previewError);
      return;
    }
    if (preview) {
      void submitAllocation(preview.computedDays);
      return;
    }
    // Preview unavailable (offline, or still in flight — previewChecking
    // already disables Submit for the latter, see the button below) fall
    // back to the old approximate-calendar-count path; only prompt when it
    // would exceed the visible balance (same soft warning as before, now a
    // ConfirmDialog instead of window.confirm()).
    if (calendarDays > selectedAlloc.balanceDays) {
      setOfflineConfirmOpen(true);
      return;
    }
    void submitAllocation(calendarDays);
  }

  const days = calcDays();

  // No employee record is linked to this account at all (a normal 404, not
  // a fetch failure — see page.tsx), and a plain `employee` role has no
  // admin-picker fallback either. There is nothing to fill in here: show a
  // clear, honest message instead of a form full of fields that can never be
  // submitted (the picker would otherwise render an unexplained, permanently
  // empty "No employees loaded" dropdown with a disabled submit button).
  if (noLinkedProfile) {
    return (
      <section className="mx-auto max-w-2xl space-y-5">
        <div
          role="alert"
          className="rounded-xl border p-6 text-sm"
          style={{ background: "var(--warnbg)", borderColor: "var(--warnbd)", color: "var(--warn)" }}
        >
          {t("noLinkedProfileMessage")}
        </div>
      </section>
    );
  }

  // The page shell (landmark <main>, page <h1>, subtitle, and "back to Leave"
  // link) is already rendered once by page.tsx via the shared <PageHeader>
  // design-system component. This component used to duplicate all of that —
  // its own <main>, its own breadcrumb nav, and its own "Apply for Leave" <h1>
  // — producing two <main> landmarks and two identical page headings on the
  // same page (caught by e2e/hr.spec.ts: getByRole('heading', { name: /leave/i })
  // resolved to 2 elements). Keep only the form itself here.
  return (
    <section className="mx-auto max-w-2xl space-y-5">
      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-xl border p-6 shadow-sm"
        style={{ background: "var(--panel)", borderColor: "var(--line)" }}
        noValidate
      >
        {/* Employee selector (not validated — always has a default) */}
        <Field id="leave-employee" label={t("employeeLabel")}>
          {pickerMode ? (
            <>
              <EntityPicker
                value={employeeId || null}
                onChange={(v) => setEmployeeId(typeof v === "string" ? v : "")}
                search={searchEmployees}
                resolve={resolveEmployees}
                initialOptions={employees.map((emp) => ({
                  id: emp.id,
                  label: emp.employeeNo ? `${emp.name} (${emp.employeeNo})` : emp.name,
                  sublabel: emp.department || undefined,
                }))}
                placeholder={t("employeePickerPlaceholder")}
                searchingText={t("employeePickerSearching")}
                noResultsText={t("employeePickerNoResults")}
              />
              {myEmployeeId && employeeId !== myEmployeeId && (
                <button
                  type="button"
                  className="btn ghost"
                  style={{ marginTop: 6, justifySelf: "start" }}
                  onClick={() => setEmployeeId(myEmployeeId)}
                >
                  {t("applyForMyselfLink")}
                </button>
              )}
              {myEmployeeId && employeeId === myEmployeeId && (
                <span className="mt-1 text-xs" style={{ color: "var(--mut)" }}>{t("myselfSuffix")}</span>
              )}
            </>
          ) : (
          <Select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            {employees.length === 0 ? (
              <option value="">{t("noEmployeesLoaded")}</option>
            ) : (
              employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} ({emp.department}){emp.id === myEmployeeId ? ` — ${t("myselfSuffix")}` : ""}
                </option>
              ))
            )}
          </Select>
          )}
          {/* GAP-HR-LEAVE-APPLY-03: only shown once there's someone else it
              could possibly mean — employees.length===1 is always the
              self-service case (page.tsx's own single-row fallback). */}
          {employees.length > 1 && employeeId && employeeId !== myEmployeeId && (employees.find((e) => e.id === employeeId)?.name ?? pickedLabel) && (
            <p className="mt-1 text-xs" style={{ color: "var(--mut)", margin: 0 }}>
              {t("onBehalfOfNote", { name: employees.find((e) => e.id === employeeId)?.name ?? pickedLabel })}
            </p>
          )}
        </Field>

        {/* Leave Type — validated: required */}
        <Field id="leave-type" label={t("leaveTypeLabel")} required error={fields.allocId.error}>
          <Select
            value={fields.allocId.value}
            onChange={fields.allocId.onChange}
            onBlur={fields.allocId.onBlur}
            disabled={!leaveContext?.allocations.length}
          >
            {!leaveContext?.allocations.length ? (
              <option value="">{t("noLeaveAllocations")}</option>
            ) : (
              <>
                <option value="">{t("selectLeaveTypePlaceholder")}</option>
                {leaveContext.allocations.map((a) => (
                  <option key={a.id} value={a.id}>
                    {t("allocationOption", { name: a.leaveTypeName, balance: a.balanceDays })}
                  </option>
                ))}
              </>
            )}
          </Select>
        </Field>

        {/* Date range — both required; toDate must be >= fromDate */}
        <div className="grid grid-cols-2 gap-4">
          <Field id="leave-from" label={t("fromDateLabel")} required error={fields.fromDate.error}>
            <Input
              type="date"
              value={fields.fromDate.value}
              onChange={fields.fromDate.onChange}
              onBlur={fields.fromDate.onBlur}
            />
          </Field>

          <Field id="leave-to" label={t("toDateLabel")} required error={fields.toDate.error}>
            <Input
              type="date"
              value={fields.toDate.value}
              onChange={fields.toDate.onChange}
              onBlur={fields.toDate.onBlur}
            />
          </Field>
        </div>

        {/* GAP-HR-LEAVE-APPLY-05: only rendered when the tenant enabled half-day /
            short leave AND this is a single-date Casual Leave request. */}
        {dayParts.length > 1 ? (
          <Field id="leave-day-part" label={t("dayPartLabel")}>
            <Select
              value={effectiveDayPart}
              onChange={(e) => setDayPart(e.target.value as LeaveDayPart)}
            >
              {dayParts.map((part) => (
                <option key={part} value={part}>{t(`dayPart_${part}`)}</option>
              ))}
            </Select>
          </Field>
        ) : null}

        {days > 0 ? (
          <div className="text-sm text-slate-600">
            {preview ? (
              // GAP-HR-LEAVE-APPLY-01: the server-confirmed count — the same
              // rules-engine computation the real submit debits from,
              // fetched via POST .../leave-requests/preview.
              <p style={{ margin: 0 }}>
                {t.rich("willDebitMessage", {
                  count: preview.computedDays,
                  typeName: selectedAlloc?.leaveTypeName ?? "",
                  strong: (chunks) => <span className="font-semibold text-slate-900">{chunks}</span>,
                })}
              </p>
            ) : (
              <>
                <p style={{ margin: 0 }}>
                  {t("durationLabel")}{" "}
                  <span className="font-semibold text-slate-900">
                    {t("daysCount", { count: days })}
                  </span>
                </p>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--mut)" }}>
                  {previewChecking ? t("checkingBalance") : t("calendarDaysDisclaimer")}
                </p>
              </>
            )}
          </div>
        ) : null}

        {/* Reason — required, min 20 chars */}
        <Field
          id="leave-reason"
          label={
            <>
              {t("reasonLabel")}
              <span className="ms-1 font-normal text-slate-500">{t("reasonHint")}</span>
            </>
          }
          required
          error={fields.reason.error}
        >
          <Textarea
            value={fields.reason.value}
            onChange={fields.reason.onChange}
            onBlur={fields.reason.onBlur}
            rows={3}
            placeholder={t("reasonPlaceholder")}
            style={{ resize: "none" }}
          />
          {!fields.reason.error && fields.reason.value.length > 0 && (
            <p className="mt-1 text-xs text-slate-400" style={{ margin: 0 }}>
              {t("charsCount", { count: fields.reason.value.trim().length })}
            </p>
          )}
        </Field>

        <button
          type="submit"
          disabled={
            status === "submitting" ||
            status === "loading" ||
            previewChecking ||
            employees.length === 0
          }
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {status === "submitting" ? t("submitSubmitting") : t("submitLabel")}
        </button>

        {message ? (
          <p
            role={status === "error" ? "alert" : "status"}
            aria-live={status === "error" ? "assertive" : "polite"}
            className={`text-sm ${status === "error" ? "text-red-600" : "text-emerald-700"}`}
          >
            <span className="font-semibold">
              {status === "error" ? t("errorPrefix") : ""}
            </span>
            {message}
          </p>
        ) : null}
      </form>

      {/* GAP-HR-LEAVE-APPLY-04: replaces window.confirm() for the ONE case
          preview can't rule on either way (offline/unreachable) — a real
          rule violation or insufficient balance now blocks inline above
          instead of reaching this dialog at all. */}
      <ConfirmDialog
        open={offlineConfirmOpen}
        title={t("confirmOverBalanceTitle")}
        confirmLabel={t("confirmOverBalanceLabel")}
        description={selectedAlloc ? t("balanceWarning", { days: calcDays(), balance: selectedAlloc.balanceDays }) : ""}
        onConfirm={() => { setOfflineConfirmOpen(false); void submitAllocation(calcDays()); }}
        onCancel={() => setOfflineConfirmOpen(false)}
      />
    </section>
  );
}
