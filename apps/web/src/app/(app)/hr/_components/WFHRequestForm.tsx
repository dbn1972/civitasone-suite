/**
 * WFHRequestForm — submits a Work-From-Home request.
 * DoPT OM 2022 / DoPT WFH policy: max 2 days/week for non-gazetted staff (Level 1–10).
 * WCAG 2.2 AA: all form fields labelled, error states, 44px touch targets.
 */
"use client";

import { useEffect, useState, useId } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { useAsyncMutation } from "@/lib/useAsyncMutation";
import { Button } from "../../../_components/ds";
import { todayIST } from "@/lib/formatters";

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
   * Non-gazetted: Level 1–10; Gazetted: Level 11–18.
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
  const [state, setState] = useState<SubmitState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const formError = useFormError("WFH request");

  const [employeeId, setEmployeeId] = useState(prefillId);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");

  const idEmp = useId();
  const idFrom = useId();
  const idTo = useId();
  const idReason = useId();
  const errId = useId();

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

  // DoPT OM 2022 eligibility gates
  const isGazetted = payLevel !== undefined && payLevel > 10;
  const weeklyCapReached = weeklyWfhCount !== undefined && weeklyWfhCount >= 2;
  const payLevelUnknown = payLevel === undefined;

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
      let res: Response;
      try {
        res = await fetch("/api/proxy/v1/hrms/wfh-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId, fromDate, toDate, reason: reason || undefined }),
        });
      } catch {
        throw new Error(formError.fromException("save").message);
      }
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        throw new Error(resolved.message);
      }
      return (await res.json()) as CreatedRequest;
    },
    poll: async (created) => {
      const qs = employeeId ? `?empId=${encodeURIComponent(employeeId)}` : "";
      const res = await fetch(`/api/proxy/v1/hrms/wfh-requests${qs}`);
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "load");
        throw new Error(resolved.message);
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
          background: "var(--info-bg, #eff6ff)",
          border: "1px solid var(--info-border, #bfdbfe)",
          borderRadius: 6,
          padding: "10px 14px",
          fontSize: 13,
          color: "var(--info-text, #1d4ed8)",
        }}
      >
        {t.rich("policyNote", {
          limit: 2,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
      </div>

      {!prefillId && (
        <div>
          <label htmlFor={idEmp} style={labelStyle}>{t("labelEmployee")}</label>
          {employees.length > 0 ? (
            <select
              id={idEmp}
              style={inputStyle}
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              required
              aria-required="true"
            >
              <option value="">{t("placeholderEmployee")}</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name ?? emp.id}{emp.employeeNo ? ` (${emp.employeeNo})` : ""}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={idEmp}
              style={inputStyle}
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              pattern="[0-9a-fA-F-]{36}"
              required
              aria-required="true"
            />
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <label htmlFor={idFrom} style={labelStyle}>{t("labelFromDate")} <span aria-hidden>*</span></label>
          <input
            id={idFrom}
            type="date"
            style={inputStyle}
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            required
            aria-required="true"
            // GAP-HR-WFH-06: was new Date().toISOString().split("T")[0] — the
            // UTC calendar date, which is still "yesterday" in India between
            // 00:00 and 05:30 IST, so the min bound (and the matching To-date
            // min below) silently blocked "today" for the first 5.5 hours of
            // every IST day. todayIST() is the drop-in IST-correct equivalent.
            min={todayIST()}
            aria-describedby={formError.fieldError("fromDate") ? "wfh-from-err" : undefined}
          />
          {formError.fieldError("fromDate") && (
            <span id="wfh-from-err" role="alert" style={{ display: "block", fontSize: 12, color: "var(--red, #dc2626)", marginTop: 4 }}>
              {formError.fieldError("fromDate")}
            </span>
          )}
        </div>
        <div>
          <label htmlFor={idTo} style={labelStyle}>{t("labelToDate")} <span aria-hidden>*</span></label>
          <input
            id={idTo}
            type="date"
            style={inputStyle}
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            required
            aria-required="true"
            min={fromDate || todayIST()}
            aria-describedby={formError.fieldError("toDate") ? "wfh-to-err" : undefined}
          />
          {formError.fieldError("toDate") && (
            <span id="wfh-to-err" role="alert" style={{ display: "block", fontSize: 12, color: "var(--red, #dc2626)", marginTop: 4 }}>
              {formError.fieldError("toDate")}
            </span>
          )}
        </div>
      </div>

      <div>
        <label htmlFor={idReason} style={labelStyle}>{t("labelReason")}</label>
        <textarea
          id={idReason}
          style={{ ...inputStyle, resize: "vertical", minHeight: 80 }}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("placeholderReason")}
          maxLength={500}
        />
      </div>

      {displayPhase !== "idle" && displayPhase !== "submitting" && (
        <p
          id={errId}
          role={displayPhase === "error" ? "alert" : "status"}
          style={{
            fontSize: 13,
            color: displayPhase === "error" ? "var(--red, #dc2626)" : "var(--green, #16a34a)",
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

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  color: "var(--muted, #6b7280)",
  marginBottom: 5,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  minHeight: 44,
};

const errorBannerStyle: React.CSSProperties = {
  background: "var(--error-bg, #fef2f2)",
  border: "1px solid var(--error-border, #fecaca)",
  borderRadius: 6,
  padding: "10px 14px",
  fontSize: 13,
  color: "var(--red, #dc2626)",
  fontWeight: 500,
};

const warningBannerStyle: React.CSSProperties = {
  background: "var(--warn-bg, #fffbeb)",
  border: "1px solid var(--warn-border, #fde68a)",
  borderRadius: 6,
  padding: "10px 14px",
  fontSize: 13,
  color: "var(--warn-text, #92400e)",
};
