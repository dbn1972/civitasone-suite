"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, ActionButton, Card, ConfirmDialog } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney, formatIndianDate, todayIST } from "@/lib/formatters";

type Props = {
  allotmentId: string;
  status: string;
  version: number;
  quarterNo: string;
  employeeRef: string;
  employeeName: string | null;
  monthlyLicenceFeeMinor: string | null;
  licenceFeeSource: "api" | "error";
  /** GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-04: only estab admins may act. */
  canAct: boolean;
  /** GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-01: session user is the applicant. */
  isApplicant: boolean;
};

export function AllotmentDetailActions({
  allotmentId,
  status,
  version,
  quarterNo,
  employeeRef,
  employeeName,
  monthlyLicenceFeeMinor,
  licenceFeeSource,
  canAct,
  isApplicant,
}: Props) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  // GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-01: polling after a command.
  const [polling, setPolling] = useState(false);

  async function patch(action: string, body: Record<string, unknown>): Promise<void> {
    await browserJson<{ status: string }>(`v1/estab/quarter-allotments/${allotmentId}/${action}`, {
      method: "PATCH",
      body: JSON.stringify({ version, ...body }),
    });
  }

  // GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-03: use the employee name.
  const employeeShort = `${employeeRef.slice(0, 8)}…`;
  const employeeLabel = employeeName ?? employeeShort;

  const licenceFeeErrored = licenceFeeSource === "error";

  function licenceFeeNote(verb: string): ReactNode {
    if (licenceFeeErrored) {
      return (
        <>
          {" "}Licence fee <strong>could not be verified</strong> — <DataSourceBadge source="error" /> Confirm the
          rate separately before proceeding.
        </>
      );
    }
    if (monthlyLicenceFeeMinor) {
      return (
        <>
          {" "}{verb} <strong>{formatMoney(monthlyLicenceFeeMinor)}</strong>.
        </>
      );
    }
    return <> No licence-fee rate is configured for this quarter type / pay level.</>;
  }

  // GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-01: poll router.refresh() after a
  // command to detect whether the status changed (CQRS async). Shows a message
  // then polls 3 times at 3s intervals.
  function pollRefresh(successMsg: string) {
    setMessage(successMsg);
    setPolling(true);
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      router.refresh();
      if (tries >= 3) {
        clearInterval(iv);
        setPolling(false);
      }
    }, 3000);
  }

  // ── Vacation-notice date field ─────────────────────────────────────
  const [vacationDueDate, setVacationDueDate] = useState("");
  const [vacationDateError, setVacationDateError] = useState<string | undefined>();
  const [vacationConfirmOpen, setVacationConfirmOpen] = useState(false);
  const [vacationBusy, setVacationBusy] = useState(false);
  const [vacationDialogError, setVacationDialogError] = useState<string | undefined>();
  const vacationDateField = useId();
  const vacationDateErrId = useId();
  const vacationDateRef = useRef<HTMLInputElement>(null);
  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  function continueVacationNotice() {
    if (!DATE_PATTERN.test(vacationDueDate.trim())) {
      setVacationDateError("Enter the vacation due date (YYYY-MM-DD).");
      vacationDateRef.current?.focus();
      return;
    }
    // GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-06: reject past dates.
    if (vacationDueDate.trim() < todayIST()) {
      setVacationDateError("Vacation due date cannot be in the past.");
      vacationDateRef.current?.focus();
      return;
    }
    setVacationDateError(undefined);
    setVacationDialogError(undefined);
    setVacationConfirmOpen(true);
  }

  async function submitVacationNotice() {
    setVacationBusy(true);
    setVacationDialogError(undefined);
    try {
      await patch("vacation-notice", { vacationDueDate: vacationDueDate.trim() });
      setVacationConfirmOpen(false);
      pollRefresh("Vacation notice issued — accepted for processing.");
    } catch (err) {
      setVacationDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setVacationBusy(false);
    }
  }

  // ── Vacate (handover notes + reason required for skip-notice) ─────
  const [handoverNotes, setHandoverNotes] = useState("");
  const handoverField = useId();

  if (status === "vacated" || status === "cancelled") {
    return (
      <Card title="Allotment lifecycle" padding>
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)" }}>
          This allotment is in a final state (<strong>{status.replace(/_/g, " ")}</strong>) — no further transitions
          are available.
        </p>
      </Card>
    );
  }

  // GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-04: non-admin viewers see status only.
  if (!canAct) {
    return (
      <Card title="Allotment lifecycle" padding>
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)" }}>
          Only estate officers and admins can act on allotment lifecycle transitions.
          Current status: <strong>{status.replace(/_/g, " ")}</strong>.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Allotment lifecycle" padding>
      <div style={{ display: "grid", gap: 12 }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)" }}>
          Allotment commands are processed asynchronously. This request is <strong>accepted</strong> immediately;
          the server applies it (including the maker-checker check that the allotting officer cannot be the
          applicant) in the background. {polling ? "Refreshing to check the new status…" : "Refresh after a moment to confirm the new status."}
        </p>

        {(status === "applied" || status === "waitlisted") && (
          <div>
            {/* GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-01: pre-check maker-checker */}
            {isApplicant && (
              <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--bad)" }}>
                You cannot allot a quarter you applied for (maker-checker policy).
              </p>
            )}
            <ActionButton
              label="Allot quarter"
              disabled={isApplicant}
              confirmTitle="Allot this quarter?"
              confirmDescription={
                <>
                  Allot quarter <strong>{quarterNo}</strong> to employee <strong>{employeeLabel}</strong>.
                  {licenceFeeNote("Monthly licence fee on occupation:")}{" "}
                  The server rejects this if the allotting officer is the same person as the applicant.
                </>
              }
              confirmLabel="Allot quarter"
              onConfirm={() => patch("allot", {})}
              onSuccess={() => pollRefresh("Allotment accepted for processing.")}
            />
          </div>
        )}

        {/* GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-05: cancel/reject applied/waitlisted */}
        {(status === "applied" || status === "waitlisted" || status === "allotted") && (
          <div>
            <ActionButton
              label={status === "allotted" ? "Cancel allotment" : "Reject application"}
              danger
              confirmTitle={status === "allotted" ? "Cancel this allotment?" : "Reject this application?"}
              confirmDescription={
                <>
                  {status === "allotted"
                    ? <>Cancel the allotment of quarter <strong>{quarterNo}</strong> for <strong>{employeeLabel}</strong>. This returns the quarter to the vacant pool.</>
                    : <>Reject the application of <strong>{employeeLabel}</strong> for quarter <strong>{quarterNo}</strong>.</>
                  }
                </>
              }
              confirmLabel={status === "allotted" ? "Cancel allotment" : "Reject application"}
              requireReason
              onConfirm={(reason) => patch("cancel", { cancelReason: reason })}
              onSuccess={() => pollRefresh(`${status === "allotted" ? "Cancellation" : "Rejection"} accepted for processing.`)}
            />
          </div>
        )}

        {status === "allotted" && (
          <div>
            <ActionButton
              label="Mark occupied"
              confirmTitle="Mark this quarter as occupied?"
              confirmDescription={
                <>
                  Mark quarter <strong>{quarterNo}</strong> as occupied by <strong>{employeeLabel}</strong>.
                  {licenceFeeNote("This starts a monthly licence-fee deduction of")}
                  {!licenceFeeErrored && monthlyLicenceFeeMinor ? " via payroll." : ""}
                </>
              }
              confirmLabel="Mark occupied"
              onConfirm={() => patch("occupy", {})}
              onSuccess={() => pollRefresh("Occupation accepted for processing.")}
            />
          </div>
        )}

        {status === "occupied" && (
          <>
            <div style={{ display: "grid", gap: 6, maxWidth: 260 }}>
              <label htmlFor={vacationDateField} style={{ fontSize: 13, fontWeight: 600 }}>
                Vacation due date <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={vacationDateField}
                ref={vacationDateRef}
                type="date"
                value={vacationDueDate}
                onChange={(e) => setVacationDueDate(e.target.value)}
                // GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-06: min = today IST
                min={todayIST()}
                aria-required="true"
                aria-invalid={!!vacationDateError || undefined}
                aria-describedby={vacationDateError ? vacationDateErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {vacationDateError && <p id={vacationDateErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{vacationDateError}</p>}
              <Button type="button" variant="ghost" style={{ minHeight: 44, width: "fit-content" }} onClick={continueVacationNotice}>
                Issue vacation notice
              </Button>
            </div>
            {/* GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-04: vacate-now (skip notice)
                separated visually and requires a reason. */}
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 4 }}>
              <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--ink2)", fontWeight: 600 }}>Danger zone</p>
              <ActionButton
                label="Vacate now (skip notice)"
                danger
                confirmTitle="Vacate immediately?"
                requireReason
                confirmDescription={
                  <>
                    Vacate quarter <strong>{quarterNo}</strong> for <strong>{employeeLabel}</strong> immediately,
                    skipping the standard notice period. This returns the quarter to the vacant pool and stops
                    licence-fee deductions. <strong>This cannot be undone.</strong>
                  </>
                }
                confirmLabel="Vacate now"
                onConfirm={(reason) => patch("vacate", { handoverNotes: reason })}
                onSuccess={() => pollRefresh("Vacation recorded — accepted for processing.")}
              />
            </div>
          </>
        )}

        {status === "vacation_notice" && (
          <div>
            <label htmlFor={handoverField} style={{ fontSize: 13, fontWeight: 600 }}>Handover notes (optional)</label>
            <textarea
              id={handoverField}
              value={handoverNotes}
              onChange={(e) => setHandoverNotes(e.target.value)}
              rows={3}
              style={{ width: "100%", padding: 10, border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, marginTop: 6, marginBottom: 8 }}
            />
            <ActionButton
              label="Record vacation"
              danger
              confirmTitle="Record vacation?"
              requireReason
              confirmDescription={
                <>
                  Record quarter <strong>{quarterNo}</strong> as vacated by <strong>{employeeLabel}</strong>. This
                  returns the quarter to the vacant pool and cannot be undone from this screen.
                </>
              }
              confirmLabel="Record vacation"
              onConfirm={(reason) => patch("vacate", { handoverNotes: handoverNotes.trim() || reason || undefined })}
              onSuccess={() => pollRefresh("Vacation recorded — accepted for processing.")}
            />
          </div>
        )}

        <div role="status">
          {message && <p className="pill good" style={{ width: "fit-content" }}>{message}</p>}
        </div>
      </div>

      <ConfirmDialog
        open={vacationConfirmOpen}
        title="Issue vacation notice?"
        confirmLabel="Issue vacation notice"
        busy={vacationBusy}
        errorMessage={vacationDialogError}
        description={
          <>
            Issue a vacation notice on quarter <strong>{quarterNo}</strong> for <strong>{employeeLabel}</strong> with
            {/* GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-06: format the date for display */}
            due date <strong>{formatIndianDate(vacationDueDate)}</strong>.
          </>
        }
        onConfirm={() => void submitVacationNotice()}
        onCancel={() => !vacationBusy && setVacationConfirmOpen(false)}
      />
    </Card>
  );
}
