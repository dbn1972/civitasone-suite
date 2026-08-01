"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionButton, Card, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";

type Props = {
  allotmentId: string;
  status: string;
  version: number;
  quarterNo: string;
  employeeRef: string;
  monthlyLicenceFeeMinor: string | null;
};

export function AllotmentDetailActions({
  allotmentId,
  status,
  version,
  quarterNo,
  employeeRef,
  monthlyLicenceFeeMinor,
}: Props) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  async function patch(action: string, body: Record<string, unknown>): Promise<void> {
    await browserJson<{ status: string }>(`v1/estab/quarter-allotments/${allotmentId}/${action}`, {
      method: "PATCH",
      body: JSON.stringify({ version, ...body }),
    });
  }

  const employeeShort = `${employeeRef.slice(0, 8)}…`;

  // ── Vacation-notice date field (own validation, own ids) ────────────────
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
      setMessage("Vacation notice issued — accepted for processing.");
      router.refresh();
    } catch (err) {
      setVacationDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setVacationBusy(false);
    }
  }

  // ── Vacate (optional handover notes) ─────────────────────────────────
  const [handoverNotes, setHandoverNotes] = useState("");
  const [vacateConfirmOpen, setVacateConfirmOpen] = useState(false);
  const [vacateBusy, setVacateBusy] = useState(false);
  const [vacateDialogError, setVacateDialogError] = useState<string | undefined>();
  const handoverField = useId();

  async function submitVacate() {
    setVacateBusy(true);
    setVacateDialogError(undefined);
    try {
      await patch("vacate", handoverNotes.trim() ? { handoverNotes: handoverNotes.trim() } : {});
      setVacateConfirmOpen(false);
      setMessage("Vacation recorded — accepted for processing.");
      router.refresh();
    } catch (err) {
      setVacateDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setVacateBusy(false);
    }
  }

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

  return (
    <Card title="Allotment lifecycle" padding>
      <div style={{ display: "grid", gap: 12 }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)" }}>
          Allotment commands are processed asynchronously. This request is <strong>accepted</strong> immediately;
          the server applies it (including the maker-checker check that the allotting officer cannot be the
          applicant) in the background. Refresh after a moment to confirm the new status.
        </p>

        {(status === "applied" || status === "waitlisted") && (
          <div>
            <ActionButton
              label="Allot quarter"
              confirmTitle="Allot this quarter?"
              confirmDescription={
                <>
                  Allot quarter <strong>{quarterNo}</strong> to employee <strong className="mono">{employeeShort}</strong>.
                  {monthlyLicenceFeeMinor && (
                    <>
                      {" "}Monthly licence fee on occupation: <strong>{formatMoney(monthlyLicenceFeeMinor)}</strong>.
                    </>
                  )}{" "}
                  The server rejects this if the allotting officer is the same person as the applicant.
                </>
              }
              confirmLabel="Allot quarter"
              onConfirm={() => patch("allot", {})}
              onSuccess={() => {
                setMessage("Allotment accepted for processing.");
                router.refresh();
              }}
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
                  Mark quarter <strong>{quarterNo}</strong> as occupied by <strong className="mono">{employeeShort}</strong>.
                  {monthlyLicenceFeeMinor && (
                    <>
                      {" "}This starts a monthly licence-fee deduction of <strong>{formatMoney(monthlyLicenceFeeMinor)}</strong> via payroll.
                    </>
                  )}
                </>
              }
              confirmLabel="Mark occupied"
              onConfirm={() => patch("occupy", {})}
              onSuccess={() => {
                setMessage("Occupation accepted for processing.");
                router.refresh();
              }}
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
                aria-required="true"
                aria-invalid={!!vacationDateError || undefined}
                aria-describedby={vacationDateError ? vacationDateErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {vacationDateError && <p id={vacationDateErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{vacationDateError}</p>}
              <button type="button" className="btn ghost" style={{ minHeight: 44, width: "fit-content" }} onClick={continueVacationNotice}>
                Issue vacation notice
              </button>
            </div>
            <div>
              <button
                type="button"
                className="btn danger"
                style={{ minHeight: 44 }}
                onClick={() => setVacateConfirmOpen(true)}
              >
                Vacate now (skip notice)
              </button>
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
            <button type="button" className="btn danger" style={{ minHeight: 44 }} onClick={() => setVacateConfirmOpen(true)}>
              Record vacation
            </button>
          </div>
        )}

        <div role="status" aria-live="polite">
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
            Issue a vacation notice on quarter <strong>{quarterNo}</strong> for <strong className="mono">{employeeShort}</strong> with
            due date <strong>{vacationDueDate}</strong>.
          </>
        }
        onConfirm={() => void submitVacationNotice()}
        onCancel={() => !vacationBusy && setVacationConfirmOpen(false)}
      />

      <ConfirmDialog
        open={vacateConfirmOpen}
        title="Record vacation?"
        danger
        confirmLabel="Record vacation"
        busy={vacateBusy}
        errorMessage={vacateDialogError}
        description={
          <>
            Record quarter <strong>{quarterNo}</strong> as vacated by <strong className="mono">{employeeShort}</strong>. This
            returns the quarter to the vacant pool and cannot be undone from this screen.
          </>
        }
        onConfirm={() => void submitVacate()}
        onCancel={() => !vacateBusy && setVacateConfirmOpen(false)}
      />
    </Card>
  );
}
