/**
 * WFHRequestForm — submits a Work-From-Home request.
 * DoPT OM 2022 / DoPT WFH policy: max 2 days/week for non-gazetted staff (Level 1–9; Level 10 and above is Group A).
 * WCAG 2.2 AA: all form fields labelled, error states, 44px touch targets.
 */
"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { useAsyncMutation } from "@/lib/useAsyncMutation";
import { Button, Field, Input, Select, Textarea } from "../../../_components/ds";
import { EmployeePicker } from "../../../_components/EmployeePicker";
import { todayIST } from "@/lib/formatters";
import { translateFormErrors } from "./translateFormErrors";
import { validateWfhRequest, type WfhRequestErrors } from "./wfhRequestSchema";

type CreatedRequest = { id: string };
type WfhRequestsList = { data: Array<{ id: string }> };

type EmployeeOption = { id: string; name?: string; employeeNo?: string };

interface WFHRequestFormProps {
  /** Pre-fill employee UUID (optional — admin filing on behalf, or the
   *  current user's own id for self-service). When set, the employee
   *  picker below is hidden entirely. */
  employeeId?: string;
  /**
   * Pay Level from the employee record (GoI pay matrix Level 1–18).
   * Eligible: Level 1–9 (default); Group A: Level 10–18.
   * Pass undefined when not yet known — form warns but allows submission.
   */
  payLevel?: number;
  /**
   * WFH days already approved/taken in the current ISO week.
   * DoPT OM 2022 cap: 2 days/week for eligible staff.
   */
  weeklyWfhCount?: number;
  /**
   * Where to send the user after a successful submit (and where Cancel
   * goes). Defaults to "/hr/wfh" — the canonical, all-roles WFH page.
   * /hr/workforce/wfh (this form's original home) is now a redirect stub to
   * /hr/wfh (HRMS peripheral medium findings, item 1: orphaned duplicate
   * page, zero inbound links); a default pointing there would still resolve
   * correctly via that redirect, but pointing straight at the canonical
   * route avoids the pointless extra hop and matches what /hr/wfh/page.tsx
   * already passes explicitly. Pass a different value only if some future
   * caller genuinely needs to land elsewhere post-submit (CRITICAL fix,
   * still applies — this was previously hardcoded to the role-gated admin
   * page, which 403'd a plain `employee` submitting their own request).
   */
  redirectHref?: string;
}

type SubmitState = "idle" | "submitting" | "done" | "error";

export function WFHRequestForm({
  employeeId: prefillId = "",
  payLevel,
  weeklyWfhCount,
  redirectHref = "/hr/wfh",
}: WFHRequestFormProps) {
  const router = useRouter();
  const t = useTranslations("wfhForm");
  const tv = useTranslations("hrFormErrors");
  const [state, setState] = useState<SubmitState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const formError = useFormError("WFH request");

  const [employeeId, setEmployeeId] = useState(prefillId);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");

  const errId = useId();
  const [clientErrors, setClientErrors] = useState<WfhRequestErrors>({});
  /** Client validation first, then a backend rejection for the same field. */
  const errFor = (f: keyof WfhRequestErrors) => clientErrors[f] ?? formError.fieldError(f);
  const clearClientError = (f: keyof WfhRequestErrors) =>
    setClientErrors((e) => (e[f] ? { ...e, [f]: undefined } : e));

  // UX: replaces the raw "paste an employee UUID" text box below with a
  // searchable name-based dropdown, matching the pattern already used by
  // PromoteWithApproval/TransferWithApproval. Only needed when nobody
  // already told us the employee (prefillId) -- so skip the fetch then.
  useEffect(() => {
    if (prefillId) return;
    let cancelled = false;
    try {
      fetch("/api/proxy/v1/hrms/employees?limit=500")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((body: { data?: EmployeeOption[] } | EmployeeOption[]) => {
          if (cancelled) return;
          setEmployees(Array.isArray(body) ? body : (body.data ?? []));
        })
        .catch(() => { /* graceful fallback to raw-UUID input below */ });
    } catch {
      /* graceful fallback to raw-UUID input below */
    }
    return () => { cancelled = true; };
  }, [prefillId]);

  // GAP-HR-WFH-01: the server knows the employee's pay level (designation
  // level, 7th CPC) and this week's count; ask it for whichever employee is
  // selected so the banner/submit-disable are real, not "could not be
  // verified" for everyone. Explicit props (tests, callers that already know)
  // still win. The server re-enforces on submit regardless.
  const [elig, setElig] = useState<{
    payLevel: number | null;
    maxPayLevel: number;
    enforceGazettedExclusion: boolean;
    weeklyWfhCount: number;
    /** Monday-Sunday ("YYYY-MM-DD") of the week `weeklyWfhCount` describes. Absent on an older server. */
    weekStart?: string;
    weekEnd?: string;
  } | null>(null);
  useEffect(() => {
    setElig(null);
    if (!employeeId) return;
    const controller = new AbortController();
    fetch(`/api/proxy/v1/hrms/wfh-eligibility?employeeId=${encodeURIComponent(employeeId)}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (body && typeof body === "object" && "weeklyWfhCount" in body) setElig(body);
      })
      .catch(() => { /* eligibility is advisory here; the POST re-checks */ });
    return () => controller.abort();
  }, [employeeId]);
  const knownPayLevel = payLevel ?? (elig?.payLevel ?? undefined);
  const knownWeekly = weeklyWfhCount ?? elig?.weeklyWfhCount;
  const gazettedLimit = elig?.maxPayLevel ?? 9;
  const enforceGazetted = elig?.enforceGazettedExclusion ?? true;

  // DoPT OM 2022 eligibility gates
  const isGazetted = enforceGazetted && knownPayLevel !== undefined && knownPayLevel > gazettedLimit;
  // The server's count is for ONE week (its current ISO week); the cap is per
  // week, so a full current week must not block a request for a LATER week --
  // otherwise someone who used both days this week could never file for next
  // week from the form, though the server would accept it. Apply the count only
  // when the chosen dates touch the week it describes (or no date is chosen
  // yet, where "you have used this week's days" is still the useful notice).
  // An explicit weeklyWfhCount prop, or an older server without the week
  // bounds, keeps the unconditional behaviour. The server stays authoritative
  // either way and re-checks every touched week on submit.
  const countWeek =
    weeklyWfhCount === undefined && elig?.weekStart && elig?.weekEnd
      ? { start: elig.weekStart, end: elig.weekEnd }
      : null;
  const rangeEnd = toDate && toDate >= fromDate ? toDate : fromDate;
  const rangeTouchesCountWeek = !countWeek || !fromDate || (fromDate <= countWeek.end && rangeEnd >= countWeek.start);
  const weeklyCapReached = knownWeekly !== undefined && knownWeekly >= 2 && rangeTouchesCountWeek;
  const payLevelUnknown = knownPayLevel === undefined;

  // SF-15: the POST below is a 202-accepted async write (CLAUDE.md CQRS
  // rule) -- the row this creates only exists once the queue consumer runs,
  // not the instant the POST resolves. Previously this component assumed a
  // fixed 900ms was always enough and redirected regardless. Now it shows an
  // explicit pending state and polls GET /wfh-requests (the same list the
  // /hr/wfh page reads) until the new request's id actually appears, and
  // only then navigates -- falling back to a "still processing" message
  // rather than guessing forever if it doesn't show up in time.
  const asyncMutation = useAsyncMutation<CreatedRequest, WfhRequestsList>({
    mutate: async () => {
      // The employee picker has no native `required`; refuse an empty pick here.
      if (!employeeId) throw new UserFacingError(t("errorEmployeeRequired"));
      let res: Response;
      try {
        res = await fetch("/api/proxy/v1/hrms/wfh-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId, fromDate, toDate, reason: reason || undefined }),
        });
      } catch (caught) {
        throw UserFacingError.from(formError.fromException("save", caught));
      }
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        throw UserFacingError.from(resolved);
      }
      return (await res.json()) as CreatedRequest;
    },
    poll: async (created) => {
      const qs = employeeId ? `?empId=${encodeURIComponent(employeeId)}` : "";
      const res = await fetch(`/api/proxy/v1/hrms/wfh-requests${qs}`);
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "load");
        throw UserFacingError.from(resolved);
      }
      return (await res.json()) as WfhRequestsList;
    },
    isDone: (polled, created) => polled.data.some((row) => row.id === created.id),
    onConfirmed: () => router.push(redirectHref),
  });

  const submitDisabled = isGazetted || weeklyCapReached || asyncMutation.isBusy;
  const displayPhase = state === "error" ? "error" : asyncMutation.phase;
  const displayErrorMsg = state === "error" ? errorMsg : asyncMutation.error;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isGazetted || weeklyCapReached) return; // belt-and-suspenders
    const errs = translateFormErrors(validateWfhRequest({ employeeId, fromDate, toDate, reason }), tv);
    setClientErrors(errs);
    if (!fromDate || !toDate) {
      setErrorMsg(t("errorBothDatesRequired"));
      setState("error");
      return;
    }
    if (toDate < fromDate) {
      setErrorMsg(t("errorToBeforeFrom"));
      setState("error");
      return;
    }
    if (Object.keys(errs).length > 0) {
      setErrorMsg(!employeeId ? t("errorEmployeeRequired") : (Object.values(errs)[0] ?? ""));
      setState("error");
      return;
    }
    setState("idle");
    setErrorMsg("");
    formError.clear();
    await asyncMutation.run();
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label={t("ariaLabel")}
      style={{ display: "flex", flexDirection: "column", gap: 18, padding: "20px 24px" }}
    >
      {/* DoPT OM 2022 eligibility banners */}

      {isGazetted && (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="gazetted-error"
          style={errorBannerStyle}
        >
          {t("gazettedError")}
        </div>
      )}

      {weeklyCapReached && !isGazetted && (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="weekly-cap-error"
          style={errorBannerStyle}
        >
          {t("weeklyCapError")}
        </div>
      )}

      {payLevelUnknown && !isGazetted && !weeklyCapReached && (
        <div
          role="note"
          data-testid="paylevel-warning"
          style={warningBannerStyle}
        >
          {t("payLevelWarning")}
        </div>
      )}

      {/* DoPT policy note */}
      <div
        role="note"
        style={{
          background: "var(--info-bg)",
          border: "1px solid var(--info-border)",
          borderRadius: 6,
          padding: "10px 14px",
          fontSize: 13,
          color: "var(--info-text)",
        }}
      >
        {t.rich("policyNote", {
          limit: 2,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
      </div>

      {!prefillId && (
        <Field label={t("labelEmployee")} required error={errFor("employeeId")}>
          {employees.length > 0 ? (
            <Select
              value={employeeId}
              onChange={(e) => { setEmployeeId(e.target.value); clearClientError("employeeId"); }}
            >
              <option value="">{t("placeholderEmployee")}</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name ?? emp.id}{emp.employeeNo ? ` (${emp.employeeNo})` : ""}
                </option>
              ))}
            </Select>
          ) : (
            <EmployeePicker value={employeeId || null} onChange={(id) => { setEmployeeId(id ?? ""); clearClientError("employeeId"); }} />
          )}
        </Field>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label={t("labelFromDate")} required error={errFor("fromDate")}>
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => { setFromDate(e.target.value); clearClientError("fromDate"); }}
            // GAP-HR-WFH-06: was new Date().toISOString().split("T")[0] — the
            // UTC calendar date, which is still "yesterday" in India between
            // 00:00 and 05:30 IST, so the min bound (and the matching To-date
            // min below) silently blocked "today" for the first 5.5 hours of
            // every IST day. todayIST() is the drop-in IST-correct equivalent.
            min={todayIST()}
          />
        </Field>
        <Field label={t("labelToDate")} required error={errFor("toDate")}>
          <Input
            type="date"
            value={toDate}
            onChange={(e) => { setToDate(e.target.value); clearClientError("toDate"); }}
            min={fromDate || todayIST()}
          />
        </Field>
      </div>

      <Field label={t("labelReason")} error={errFor("reason")}>
        <Textarea
          style={{ resize: "vertical", minHeight: 80 }}
          value={reason}
          onChange={(e) => { setReason(e.target.value); clearClientError("reason"); }}
          placeholder={t("placeholderReason")}
          maxLength={500}
        />
      </Field>

      {displayPhase !== "idle" && displayPhase !== "submitting" && (
        <p
          id={errId}
          role={displayPhase === "error" ? "alert" : "status"}
          style={{
            fontSize: 13,
            color: displayPhase === "error" ? "var(--red)" : "var(--green)",
            margin: 0,
          }}
        >
          {displayPhase === "error" && displayErrorMsg}
          {displayPhase === "pending" && t("confirming")}
          {displayPhase === "confirmed" && t("successMessage")}
          {displayPhase === "timed_out" && t("stillProcessing")}
        </p>
      )}

      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
        <Button
          type="button"
          variant="ghost"
          style={{ minHeight: 44 }}
          onClick={() => router.push(redirectHref)}
        >
          {t("cancel")}
        </Button>
        <Button
          type="submit"
          style={{ minHeight: 44 }}
          disabled={submitDisabled}
          aria-busy={asyncMutation.isBusy}
          aria-disabled={submitDisabled}
        >
          {asyncMutation.isBusy ? t("submitting") : t("submitRequest")}
        </Button>
      </div>
    </form>
  );
}

const errorBannerStyle: React.CSSProperties = {
  background: "var(--error-bg)",
  border: "1px solid var(--error-border)",
  borderRadius: 6,
  padding: "10px 14px",
  fontSize: 13,
  color: "var(--red)",
  fontWeight: 500,
};

const warningBannerStyle: React.CSSProperties = {
  background: "var(--warn-bg)",
  border: "1px solid var(--warn-border)",
  borderRadius: 6,
  padding: "10px 14px",
  fontSize: 13,
  color: "var(--warn-text)",
};
