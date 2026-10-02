"use client";

/**
 * Condemnation → committee recommendation (maker-checker) → auction workflow.
 *
 * GAP-ASSETS-CONDEMNATION-01/02/03: every step picks its record from the
 * asset-service read models (GET condemnation-surveys / -recommendations /
 * auctions and the asset register), loaded server-side by page.tsx. Nothing
 * is typed as a UUID, the optimistic-lock `version` comes from the fetched
 * record (never typed by the clerk), and a reload keeps the workflow because
 * the state lives on the server, not in component state.
 *
 * Every command is answered 202 "accepted" and applied by a queue consumer,
 * so success copy says "submitted"; the new/updated record shows up in the
 * pickers after a refresh. Maker-checker on recommendation approval
 * (approver ≠ creator) is enforced by the consumer.
 */
import { useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ConfirmDialog } from "@/app/_components/ds";
import { condemnationCommand } from "./commandApi";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney, formatIndianDate, todayIST } from "@/lib/formatters";
import { EntityPicker } from "@/app/_components/ds";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";
import { checkAuctionCompletion, isRealCalendarDate } from "./condemnationRules";

// GAP-ASSETS-CONDEMNATION-07: "today" is the IST calendar day, not UTC (which is
// still yesterday until 05:30 IST), and a date must be a real calendar day.
const today = () => todayIST();

type Accepted = { id: string; status: string; correlationId: string };

export type AssetOption = { id: string; label: string };
export type SurveyRecord = { id: string; assetId: string; status: string; condition: string; surveyDate: string; version: number };
export type RecommendationRecord = {
  id: string;
  surveyId: string;
  assetId: string;
  decision: string;
  status: string;
  version: number;
  reserveValueMinor: string | null;
  floorValueMinor: string | null;
};
export type AuctionRecord = { id: string; assetId: string; recommendationId: string; status: string; version: number; reserveValueMinor: string };

export type CondemnationData = {
  assets: AssetOption[];
  surveys: SurveyRecord[];
  recommendations: RecommendationRecord[];
  auctions: AuctionRecord[];
  /** Which read models failed to load (so an empty picker is not mistaken for "none"). */
  failed: { assets?: boolean; surveys?: boolean; recommendations?: boolean; auctions?: boolean };
};

const EMPTY: CondemnationData = { assets: [], surveys: [], recommendations: [], auctions: [], failed: {} };

// ── shared field primitives ───────────────────────────────────────────────

function Field({
  id,
  label,
  error,
  required = true,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <label htmlFor={id} style={{ fontSize: 13, fontWeight: 600 }}>
        {label}{" "}
        {required && (
          <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>
            *
          </span>
        )}
      </label>
      {children}
      {error && (
        <p id={`${id}-err`} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--line)",
  minHeight: 44,
};

function TextInput({
  id,
  value,
  onChange,
  error,
  placeholder,
  required = true,
  inputRef,
  inputMode,
  type,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  placeholder?: string;
  required?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  type?: string;
}) {
  return (
    <input
      id={id}
      ref={inputRef}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      inputMode={inputMode}
      aria-required={required ? "true" : undefined}
      aria-invalid={!!error || undefined}
      aria-describedby={error ? `${id}-err` : undefined}
      style={inputStyle}
    />
  );
}

function SelectInput({
  id,
  value,
  onChange,
  options,
  error,
  selectRef,
  emptyLabel,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  error?: string;
  selectRef?: React.Ref<HTMLSelectElement>;
  /** When set and there are no options, the select is disabled and shows this. */
  emptyLabel?: string;
}) {
  const empty = emptyLabel !== undefined && options.length === 0;
  return (
    <select
      id={id}
      ref={selectRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={empty}
      aria-required="true"
      aria-invalid={!!error || undefined}
      aria-describedby={error ? `${id}-err` : undefined}
      style={inputStyle}
    >
      <option value="">{empty ? emptyLabel : "Select…"}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function grid(children: ReactNode) {
  return (
    <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
      {children}
    </div>
  );
}

function emptyText(failed: boolean | undefined, none: string): string {
  return failed ? "Couldn't load — refresh to retry" : none;
}

function humanise(v: string): string {
  return v.replace(/_/g, " ");
}

/** Shared label helpers so every panel names records the same way. */
function useLabels(data: CondemnationData) {
  const assetLabel = (id: string) => data.assets.find((a) => a.id === id)?.label ?? "Unknown asset";
  const surveyLabel = (s: SurveyRecord) => `${assetLabel(s.assetId)} — ${humanise(s.condition)}, surveyed ${formatIndianDate(s.surveyDate)}`;
  const recLabel = (r: RecommendationRecord) => `${assetLabel(r.assetId)} — ${humanise(r.decision)} (${humanise(r.status)})`;
  const auctionLabel = (a: AuctionRecord) => `${assetLabel(a.assetId)} — reserve ${formatMoney(a.reserveValueMinor)}`;
  return { assetLabel, surveyLabel, recLabel, auctionLabel };
}

// ── Survey panel ───────────────────────────────────────────────────────────

function SurveyPanel({ data, onDone }: { data: CondemnationData; onDone: () => void }) {
  const { assetLabel, surveyLabel } = useLabels(data);
  const [assetId, setAssetId] = useState("");
  const [surveyDate, setSurveyDate] = useState(today());
  const [condition, setCondition] = useState("");
  const [conditionNotes, setConditionNotes] = useState("");
  const [yearsInUse, setYearsInUse] = useState("");
  const [repairCost, setRepairCost] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const [surveyId, setSurveyId] = useState("");
  const [submitRecommendation, setSubmitRecommendation] = useState("");
  const [submitErrors, setSubmitErrors] = useState<Record<string, string>>({});
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitDialogError, setSubmitDialogError] = useState<string | undefined>();
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);

  const assetIdField = useId();
  const surveyDateField = useId();
  const conditionField = useId();
  const notesField = useId();
  const yearsField = useId();
  const repairField = useId();
  const surveyIdField = useId();
  const recommendationField = useId();

  const assetRef = useRef<HTMLSelectElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const conditionRef = useRef<HTMLSelectElement>(null);
  const repairRef = useRef<HTMLInputElement>(null);
  const surveyIdRef = useRef<HTMLSelectElement>(null);

  const draftSurveys = data.surveys.filter((s) => s.status === "draft");
  const selectedSurvey = draftSurveys.find((s) => s.id === surveyId) ?? null;

  function validateCreate(): boolean {
    const next: Record<string, string> = {};
    if (!data.assets.some((a) => a.id === assetId)) next.assetId = "Select the asset being surveyed.";
    if (!isRealCalendarDate(surveyDate.trim())) next.surveyDate = "Enter a valid survey date.";
    else if (surveyDate.trim() > today()) next.surveyDate = "A survey cannot be dated in the future.";
    if (!condition) next.condition = "Select the condemnation condition.";
    if (repairCost.trim() && rupeesToMinorString(repairCost, { allowZero: true }) === null) {
      next.repairCost = "Enter a valid non-negative repair cost (₹) with at most 2 decimals.";
    }
    setErrors(next);
    if (next.assetId) { assetRef.current?.focus(); return false; }
    if (next.surveyDate) { dateRef.current?.focus(); return false; }
    if (next.condition) { conditionRef.current?.focus(); return false; }
    if (next.repairCost) { repairRef.current?.focus(); return false; }
    return Object.keys(next).length === 0;
  }

  async function createSurvey() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const body: Record<string, unknown> = { assetId, surveyDate: surveyDate.trim(), condition, currency: "INR" };
      if (conditionNotes.trim()) body.conditionNotes = conditionNotes.trim();
      if (yearsInUse.trim()) body.yearsInUse = Number(yearsInUse);
      if (repairCost.trim()) body.estimatedRepairCostMinor = Number(rupeesToMinorString(repairCost, { allowZero: true }));
      await condemnationCommand<Accepted>("v1/asset/condemnation-surveys", { method: "POST", body: JSON.stringify(body) });
      setConfirmOpen(false);
      setMessage(`Survey for ${assetLabel(assetId)} submitted. It appears under "Submit survey" once processed.`);
      setAssetId("");
      setCondition("");
      onDone();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function validateSubmit(): boolean {
    const next: Record<string, string> = {};
    if (!selectedSurvey) next.surveyId = "Select a draft survey.";
    if (!submitRecommendation) next.submitRecommendation = "Select the survey recommendation.";
    setSubmitErrors(next);
    if (next.surveyId) { surveyIdRef.current?.focus(); return false; }
    return Object.keys(next).length === 0;
  }

  async function submitSurvey() {
    if (!selectedSurvey) return;
    setSubmitBusy(true);
    setSubmitDialogError(undefined);
    try {
      await condemnationCommand<Accepted>(`v1/asset/condemnation-surveys/${selectedSurvey.id}/submit`, {
        method: "PATCH",
        // Optimistic lock from the fetched record -- never typed by the clerk.
        body: JSON.stringify({ version: selectedSurvey.version, recommendation: submitRecommendation }),
      });
      setSubmitConfirmOpen(false);
      setSubmitMessage(`Survey for ${assetLabel(selectedSurvey.assetId)} submitted with recommendation "${humanise(submitRecommendation)}".`);
      setSurveyId("");
      onDone();
    } catch (err) {
      setSubmitDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setSubmitBusy(false);
    }
  }

  return (
    <Card title="1. Condemnation survey">
      <div className="pad" style={{ display: "grid", gap: 18 }}>
        <div style={{ display: "grid", gap: 14 }}>
          <h4 style={{ margin: 0 }}>Create survey</h4>
          {grid(
            <>
              <Field id={assetIdField} label="Asset" error={errors.assetId}>
                <SelectInput
                  id={assetIdField}
                  selectRef={assetRef}
                  value={assetId}
                  onChange={setAssetId}
                  error={errors.assetId}
                  options={data.assets.map((a) => ({ value: a.id, label: a.label }))}
                  emptyLabel={emptyText(data.failed.assets, "No assets in the register")}
                />
              </Field>
              <Field id={surveyDateField} label="Survey date" error={errors.surveyDate}>
                <TextInput id={surveyDateField} type="date" inputRef={dateRef} value={surveyDate} onChange={setSurveyDate} error={errors.surveyDate} />
              </Field>
              <Field id={conditionField} label="Condition" error={errors.condition}>
                <SelectInput
                  id={conditionField}
                  selectRef={conditionRef}
                  value={condition}
                  onChange={setCondition}
                  error={errors.condition}
                  options={[
                    { value: "good", label: "Good" },
                    { value: "fair", label: "Fair" },
                    { value: "poor", label: "Poor" },
                    { value: "unserviceable", label: "Unserviceable" },
                    { value: "beyond_repair", label: "Beyond repair" },
                  ]}
                />
              </Field>
              <Field id={yearsField} label="Years in use" required={false}>
                <TextInput id={yearsField} value={yearsInUse} onChange={setYearsInUse} placeholder="e.g. 8" inputMode="numeric" required={false} />
              </Field>
              <Field id={repairField} label="Estimated repair cost (₹)" required={false} error={errors.repairCost}>
                <TextInput id={repairField} inputRef={repairRef} value={repairCost} onChange={setRepairCost} placeholder="e.g. 15000" inputMode="decimal" required={false} error={errors.repairCost} />
              </Field>
            </>,
          )}
          <Field id={notesField} label="Condition notes" required={false}>
            <textarea id={notesField} value={conditionNotes} onChange={(e) => setConditionNotes(e.target.value)} rows={2} style={{ ...inputStyle, minHeight: 60 }} />
          </Field>
          <div>
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                setMessage(null);
                if (!validateCreate()) return;
                setDialogError(undefined);
                setConfirmOpen(true);
              }}
            >
              Create Survey
            </Button>
          </div>
          {message && <p role="status" className="pill good" style={{ width: "fit-content" }}>{message}</p>}
        </div>

        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, display: "grid", gap: 14 }}>
          <h4 style={{ margin: 0 }}>Submit survey</h4>
          {grid(
            <>
              <Field id={surveyIdField} label="Draft survey" error={submitErrors.surveyId}>
                <SelectInput
                  id={surveyIdField}
                  selectRef={surveyIdRef}
                  value={surveyId}
                  onChange={setSurveyId}
                  error={submitErrors.surveyId}
                  options={draftSurveys.map((s) => ({ value: s.id, label: surveyLabel(s) }))}
                  emptyLabel={emptyText(data.failed.surveys, "No draft surveys")}
                />
              </Field>
              <Field id={recommendationField} label="Recommendation" error={submitErrors.submitRecommendation}>
                <SelectInput
                  id={recommendationField}
                  value={submitRecommendation}
                  onChange={setSubmitRecommendation}
                  error={submitErrors.submitRecommendation}
                  options={[
                    { value: "condemn", label: "Condemn" },
                    { value: "repair", label: "Repair" },
                    { value: "continue_use", label: "Continue use" },
                  ]}
                />
              </Field>
            </>,
          )}
          <div>
            <Button
              type="button"
              variant="ghost"
              disabled={submitBusy}
              onClick={() => {
                setSubmitMessage(null);
                if (!validateSubmit()) return;
                setSubmitDialogError(undefined);
                setSubmitConfirmOpen(true);
              }}
            >
              Submit Survey
            </Button>
          </div>
          {submitMessage && <p role="status" className="pill good" style={{ width: "fit-content" }}>{submitMessage}</p>}
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Create this condemnation survey?"
        confirmLabel="Create survey"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Records a condemnation survey for <strong>{assetLabel(assetId)}</strong> with condition{" "}
            <strong>{condition ? humanise(condition) : "—"}</strong>.
          </>
        }
        onConfirm={() => void createSurvey()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />

      <ConfirmDialog
        open={submitConfirmOpen}
        title="Submit this survey?"
        confirmLabel="Submit survey"
        busy={submitBusy}
        errorMessage={submitDialogError}
        description={
          <>
            Submits the survey for <strong>{selectedSurvey ? assetLabel(selectedSurvey.assetId) : "—"}</strong> with recommendation{" "}
            <strong>{submitRecommendation ? humanise(submitRecommendation) : "—"}</strong>. This locks the survey against further edits.
          </>
        }
        onConfirm={() => void submitSurvey()}
        onCancel={() => !submitBusy && setSubmitConfirmOpen(false)}
      />
    </Card>
  );
}

// ── Recommendation panel ────────────────────────────────────────────────

type CommitteeMember = { name: string; designation: string; employeeRef: string };
const emptyMember = (): CommitteeMember => ({ name: "", designation: "", employeeRef: "" });

function RecommendationPanel({ data, onDone }: { data: CondemnationData; onDone: () => void }) {
  const { assetLabel, surveyLabel, recLabel } = useLabels(data);
  const [surveyId, setSurveyId] = useState("");
  const [members, setMembers] = useState<CommitteeMember[]>([emptyMember(), emptyMember()]);
  const [decision, setDecision] = useState("");
  const [reason, setReason] = useState("");
  const [reserveValue, setReserveValue] = useState("");
  const [floorValue, setFloorValue] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const [recommendationId, setRecommendationId] = useState("");
  const [approveErrors, setApproveErrors] = useState<Record<string, string>>({});
  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false);
  const [approveBusy, setApproveBusy] = useState(false);
  const [approveDialogError, setApproveDialogError] = useState<string | undefined>();
  const [approveMessage, setApproveMessage] = useState<string | null>(null);

  const surveyIdField = useId();
  const decisionField = useId();
  const reasonField = useId();
  const reserveField = useId();
  const floorField = useId();
  const recommendationIdField = useId();

  const surveyRef = useRef<HTMLSelectElement>(null);
  const decisionRef = useRef<HTMLSelectElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const firstMemberRef = useRef<HTMLInputElement>(null);
  const reserveRef = useRef<HTMLInputElement>(null);
  const floorRef = useRef<HTMLInputElement>(null);
  const recIdRef = useRef<HTMLSelectElement>(null);

  // A recommendation follows a SUBMITTED survey; the asset comes from it.
  const submittedSurveys = data.surveys.filter((s) => s.status === "submitted");
  const selectedSurvey = submittedSurveys.find((s) => s.id === surveyId) ?? null;
  const pendingRecs = data.recommendations.filter((r) => r.status === "pending");
  const selectedRec = pendingRecs.find((r) => r.id === recommendationId) ?? null;

  function updateMember(i: number, patch: Partial<CommitteeMember>) {
    setMembers((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  }

  function validateCreate(): boolean {
    const next: Record<string, string> = {};
    if (!selectedSurvey) next.surveyId = "Select a submitted survey.";
    if (!decision) next.decision = "Select the committee's decision.";
    if (!reason.trim()) next.reason = "Enter the committee's reason.";
    const validMembers = members.filter((m) => m.name.trim() && m.designation.trim());
    if (validMembers.length < 2) next.members = "At least 2 committee members (name + designation) are required.";
    if (reserveValue.trim() && rupeesToMinorString(reserveValue, { allowZero: true }) === null) next.reserveValue = "Enter a valid non-negative reserve value (₹).";
    if (floorValue.trim() && rupeesToMinorString(floorValue, { allowZero: true }) === null) next.floorValue = "Enter a valid non-negative floor value (₹).";
    setErrors(next);
    if (next.surveyId) { surveyRef.current?.focus(); return false; }
    if (next.decision) { decisionRef.current?.focus(); return false; }
    if (next.reason) { reasonRef.current?.focus(); return false; }
    if (next.members) { firstMemberRef.current?.focus(); return false; }
    if (next.reserveValue) { reserveRef.current?.focus(); return false; }
    if (next.floorValue) { floorRef.current?.focus(); return false; }
    return Object.keys(next).length === 0;
  }

  async function createRecommendation() {
    if (!selectedSurvey) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const committeeMembers = members
        .filter((m) => m.name.trim() && m.designation.trim())
        .map((m) => ({
          name: m.name.trim(),
          designation: m.designation.trim(),
          ...(m.employeeRef.trim() ? { employeeRef: m.employeeRef.trim() } : {}),
        }));
      const body: Record<string, unknown> = {
        surveyId: selectedSurvey.id,
        assetId: selectedSurvey.assetId,
        committeeMembers,
        decision,
        reason: reason.trim(),
        currency: "INR",
      };
      if (reserveValue.trim()) body.reserveValueMinor = Number(rupeesToMinorString(reserveValue, { allowZero: true }));
      if (floorValue.trim()) body.floorValueMinor = Number(rupeesToMinorString(floorValue, { allowZero: true }));
      await condemnationCommand<Accepted>("v1/asset/condemnation-recommendations", { method: "POST", body: JSON.stringify(body) });
      setConfirmOpen(false);
      setMessage(`Recommendation for ${assetLabel(selectedSurvey.assetId)} submitted. It appears under "Approve recommendation" once processed.`);
      setSurveyId("");
      onDone();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function validateApprove(): boolean {
    const next: Record<string, string> = {};
    if (!selectedRec) next.recommendationId = "Select a pending recommendation.";
    setApproveErrors(next);
    if (next.recommendationId) { recIdRef.current?.focus(); return false; }
    return true;
  }

  async function approveRecommendation(approvalReason?: string) {
    if (!selectedRec) return;
    setApproveBusy(true);
    setApproveDialogError(undefined);
    try {
      await condemnationCommand<Accepted>(`v1/asset/condemnation-recommendations/${selectedRec.id}/approve`, {
        method: "PATCH",
        body: JSON.stringify({ version: selectedRec.version, reason: (approvalReason ?? "").trim() }),
      });
      setApproveConfirmOpen(false);
      // Fail-closed: the maker≠checker check runs in the queue consumer, not
      // in this HTTP response -- a 202 means "accepted", never "approved".
      setApproveMessage(`Approval submitted for ${assetLabel(selectedRec.assetId)} — pending the maker≠checker verification.`);
      setRecommendationId("");
      onDone();
    } catch (err) {
      setApproveDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setApproveBusy(false);
    }
  }

  return (
    <Card title="2. Committee recommendation (maker-checker)">
      <div className="pad" style={{ display: "grid", gap: 18 }}>
        <div style={{ display: "grid", gap: 14 }}>
          <h4 style={{ margin: 0 }}>Create recommendation</h4>
          {grid(
            <>
              <Field id={surveyIdField} label="Submitted survey" error={errors.surveyId}>
                <SelectInput
                  id={surveyIdField}
                  selectRef={surveyRef}
                  value={surveyId}
                  onChange={setSurveyId}
                  error={errors.surveyId}
                  options={submittedSurveys.map((s) => ({ value: s.id, label: surveyLabel(s) }))}
                  emptyLabel={emptyText(data.failed.surveys, "No submitted surveys")}
                />
              </Field>
              <Field id={decisionField} label="Decision" error={errors.decision}>
                <SelectInput
                  id={decisionField}
                  selectRef={decisionRef}
                  value={decision}
                  onChange={setDecision}
                  error={errors.decision}
                  options={[
                    { value: "condemn", label: "Condemn" },
                    { value: "repair", label: "Repair" },
                    { value: "continue_use", label: "Continue use" },
                    { value: "downgrade", label: "Downgrade" },
                  ]}
                />
              </Field>
              <Field id={reserveField} label="Reserve value (₹)" required={false} error={errors.reserveValue}>
                <TextInput id={reserveField} inputRef={reserveRef} value={reserveValue} onChange={setReserveValue} inputMode="decimal" required={false} error={errors.reserveValue} />
              </Field>
              <Field id={floorField} label="Floor value (₹)" required={false} error={errors.floorValue}>
                <TextInput id={floorField} inputRef={floorRef} value={floorValue} onChange={setFloorValue} inputMode="decimal" required={false} error={errors.floorValue} />
              </Field>
            </>,
          )}
          <Field id={reasonField} label="Reason" error={errors.reason}>
            <textarea
              id={reasonField}
              ref={reasonRef}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              aria-required="true"
              aria-invalid={!!errors.reason || undefined}
              aria-describedby={errors.reason ? `${reasonField}-err` : undefined}
              style={{ ...inputStyle, minHeight: 60 }}
            />
          </Field>

          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              Committee members <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span> (min. 2)
            </div>
            {members.map((m, i) => (
              <div key={i} style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", alignItems: "start" }}>
                <Field id={`member-${i}-name`} label={`Member ${i + 1} name`} required={false}>
                  <TextInput id={`member-${i}-name`} inputRef={i === 0 ? firstMemberRef : undefined} value={m.name} onChange={(v) => updateMember(i, { name: v })} required={false} />
                </Field>
                <Field id={`member-${i}-designation`} label={`Member ${i + 1} designation`} required={false}>
                  <TextInput id={`member-${i}-designation`} value={m.designation} onChange={(v) => updateMember(i, { designation: v })} required={false} />
                </Field>
                {/* GAP-ASSETS-CONDEMNATION-05: the officer is chosen by name, never a typed UUID. */}
                <Field id={`member-${i}-employeeRef`} label={`Member ${i + 1} officer`} required={false}>
                  <EntityPicker
                    id={`member-${i}-employeeRef`}
                    value={m.employeeRef || null}
                    onChange={(v) => updateMember(i, { employeeRef: (Array.isArray(v) ? v[0] : v) ?? "" })}
                    search={searchEmployees}
                    resolve={resolveEmployees}
                    placeholder="Search by name or employee number (optional)"
                  />
                </Field>
              </div>
            ))}
            {errors.members && <p role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.members}</p>}
            <div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setMembers((prev) => [...prev, emptyMember()])}>
                + Add member
              </Button>
            </div>
          </div>

          <div>
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                setMessage(null);
                if (!validateCreate()) return;
                setDialogError(undefined);
                setConfirmOpen(true);
              }}
            >
              Create Recommendation
            </Button>
          </div>
          {message && <p role="status" className="pill good" style={{ width: "fit-content" }}>{message}</p>}
        </div>

        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, display: "grid", gap: 14 }}>
          <h4 style={{ margin: 0 }}>Approve recommendation</h4>
          <p style={{ margin: 0, fontSize: 12, color: "var(--ink2)" }}>
            The approving officer must be different from the officer who created the recommendation — the server
            rejects same-user maker-checker decisions.
          </p>
          {grid(
            <Field id={recommendationIdField} label="Pending recommendation" error={approveErrors.recommendationId}>
              <SelectInput
                id={recommendationIdField}
                selectRef={recIdRef}
                value={recommendationId}
                onChange={setRecommendationId}
                error={approveErrors.recommendationId}
                options={pendingRecs.map((r) => ({ value: r.id, label: recLabel(r) }))}
                emptyLabel={emptyText(data.failed.recommendations, "No pending recommendations")}
              />
            </Field>,
          )}
          <div>
            <Button
              type="button"
              variant="danger"
              disabled={approveBusy}
              onClick={() => {
                setApproveMessage(null);
                if (!validateApprove()) return;
                setApproveDialogError(undefined);
                setApproveConfirmOpen(true);
              }}
            >
              Approve Recommendation
            </Button>
          </div>
          {approveMessage && <p role="status" className="pill good" style={{ width: "fit-content" }}>{approveMessage}</p>}
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Create this committee recommendation?"
        confirmLabel="Create recommendation"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Records the committee&apos;s <strong>{decision ? humanise(decision) : "—"}</strong> decision for{" "}
            <strong>{selectedSurvey ? assetLabel(selectedSurvey.assetId) : "—"}</strong>.
          </>
        }
        onConfirm={() => void createRecommendation()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />

      {/* GAP-ASSETS-CONDEMNATION-03: every figure shown comes from the
          recommendation being approved (fetched record), never from the
          create form's local fields; a reason is mandatory. */}
      <ConfirmDialog
        open={approveConfirmOpen}
        title="Approve this condemnation recommendation?"
        confirmLabel="Submit approval"
        danger
        requireReason
        reasonLabel="Reason for approval"
        busy={approveBusy}
        errorMessage={approveDialogError}
        description={
          selectedRec ? (
            <>
              Submits your approval of the <strong>{humanise(selectedRec.decision)}</strong> recommendation for{" "}
              <strong>{assetLabel(selectedRec.assetId)}</strong> (approver must differ from creator). Reserve value{" "}
              <strong>{formatMoney(selectedRec.reserveValueMinor)}</strong> · floor value{" "}
              <strong>{formatMoney(selectedRec.floorValueMinor)}</strong>.
              {selectedRec.decision === "condemn" ? " On approval the asset is marked condemned" : " On approval the decision is final"} — this
              cannot be undone from this screen.
            </>
          ) : (
            <>Details are not loaded; select the recommendation again.</>
          )
        }
        onConfirm={(r) => void approveRecommendation(r)}
        onCancel={() => !approveBusy && setApproveConfirmOpen(false)}
      />
    </Card>
  );
}

// ── Auction panel ──────────────────────────────────────────────────────

function AuctionPanel({ data, onDone }: { data: CondemnationData; onDone: () => void }) {
  const { assetLabel, recLabel, auctionLabel } = useLabels(data);
  const [recommendationId, setRecommendationId] = useState("");
  const [reserveValue, setReserveValue] = useState("");
  const [auctionDate, setAuctionDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const [auctionId, setAuctionId] = useState("");
  const [highestBid, setHighestBid] = useState("");
  const [winnerName, setWinnerName] = useState("");
  const [winnerRef, setWinnerRef] = useState("");
  const [saleProceeds, setSaleProceeds] = useState("");
  const [completeErrors, setCompleteErrors] = useState<Record<string, string>>({});
  const [completeConfirmOpen, setCompleteConfirmOpen] = useState(false);
  const [completeBusy, setCompleteBusy] = useState(false);
  const [completeDialogError, setCompleteDialogError] = useState<string | undefined>();
  const [completeMessage, setCompleteMessage] = useState<string | null>(null);

  const recommendationIdField = useId();
  const reserveField = useId();
  const dateField = useId();
  const auctionIdField = useId();
  const bidField = useId();
  const winnerField = useId();
  const winnerRefField = useId();
  const proceedsField = useId();

  const recRef = useRef<HTMLSelectElement>(null);
  const reserveRef = useRef<HTMLInputElement>(null);
  const auctionDateRef = useRef<HTMLInputElement>(null);
  const auctionIdRef = useRef<HTMLSelectElement>(null);
  const bidRef = useRef<HTMLInputElement>(null);
  const winnerRef2 = useRef<HTMLInputElement>(null);
  const proceedsRef = useRef<HTMLInputElement>(null);

  // Only an APPROVED "condemn" recommendation can go to auction.
  const auctionableRecs = data.recommendations.filter((r) => r.status === "approved" && r.decision === "condemn");
  const selectedRec = auctionableRecs.find((r) => r.id === recommendationId) ?? null;
  const openAuctions = data.auctions.filter((a) => a.status === "pending");
  const selectedAuction = openAuctions.find((a) => a.id === auctionId) ?? null;

  function pickRecommendation(id: string) {
    setRecommendationId(id);
    const rec = auctionableRecs.find((r) => r.id === id);
    // Prefill the reserve from the approved recommendation (paise → rupees).
    if (rec?.reserveValueMinor && /^\d+$/.test(rec.reserveValueMinor)) {
      const p = rec.reserveValueMinor.padStart(3, "0");
      setReserveValue(`${p.slice(0, -2).replace(/^0+(?=\d)/, "")}.${p.slice(-2)}`);
    }
  }

  function validateCreate(): boolean {
    const next: Record<string, string> = {};
    if (!selectedRec) next.recommendationId = "Select an approved condemnation recommendation.";
    const reserveMinor = rupeesToMinorString(reserveValue);
    if (!reserveValue.trim() || reserveMinor === null) next.reserveValue = "Enter a valid positive reserve value (₹).";
    if (auctionDate.trim() && !isRealCalendarDate(auctionDate.trim())) next.auctionDate = "Enter a valid auction date.";
    setErrors(next);
    if (next.recommendationId) { recRef.current?.focus(); return false; }
    if (next.reserveValue) { reserveRef.current?.focus(); return false; }
    if (next.auctionDate) { auctionDateRef.current?.focus(); return false; }
    return Object.keys(next).length === 0;
  }

  async function createAuction() {
    if (!selectedRec) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const body: Record<string, unknown> = {
        assetId: selectedRec.assetId,
        recommendationId: selectedRec.id,
        reserveValueMinor: Number(rupeesToMinorString(reserveValue)),
        currency: "INR",
      };
      if (auctionDate.trim()) body.auctionDate = auctionDate.trim();
      await condemnationCommand<Accepted>("v1/asset/auctions", { method: "POST", body: JSON.stringify(body) });
      setConfirmOpen(false);
      setMessage(`Auction for ${assetLabel(selectedRec.assetId)} submitted. It appears under "Complete auction" once processed.`);
      setRecommendationId("");
      onDone();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function validateComplete(): boolean {
    const next: Record<string, string> = {};
    if (!selectedAuction) next.auctionId = "Select an open auction.";
    const bidMinor = rupeesToMinorString(highestBid);
    if (!highestBid.trim() || bidMinor === null) next.highestBid = "Enter a valid positive winning bid (₹).";
    if (!winnerName.trim()) next.winnerName = "Enter the winning bidder's name.";
    const proceedsMinor = rupeesToMinorString(saleProceeds);
    if (!saleProceeds.trim() || proceedsMinor === null) next.saleProceeds = "Enter valid positive sale proceeds (₹).";
    // GAP-ASSETS-CONDEMNATION-04: bid vs the auction's reserve, proceeds vs the bid.
    const rules = checkAuctionCompletion({
      bidMinor: highestBid.trim() ? bidMinor : null,
      proceedsMinor: saleProceeds.trim() ? proceedsMinor : null,
      reserveMinor: selectedAuction?.reserveValueMinor ?? null,
    });
    if (!next.highestBid && rules.highestBid) next.highestBid = rules.highestBid;
    if (!next.saleProceeds && rules.saleProceeds) next.saleProceeds = rules.saleProceeds;
    setCompleteErrors(next);
    if (next.auctionId) { auctionIdRef.current?.focus(); return false; }
    if (next.highestBid) { bidRef.current?.focus(); return false; }
    if (next.winnerName) { winnerRef2.current?.focus(); return false; }
    if (next.saleProceeds) { proceedsRef.current?.focus(); return false; }
    return Object.keys(next).length === 0;
  }

  async function completeAuction() {
    if (!selectedAuction) return;
    setCompleteBusy(true);
    setCompleteDialogError(undefined);
    try {
      const body: Record<string, unknown> = {
        version: selectedAuction.version,
        highestBidMinor: Number(rupeesToMinorString(highestBid)),
        winnerName: winnerName.trim(),
        saleProceedsMinor: Number(rupeesToMinorString(saleProceeds)),
      };
      if (winnerRef.trim()) body.winnerRef = winnerRef.trim();
      await condemnationCommand<Accepted>(`v1/asset/auctions/${selectedAuction.id}/complete`, { method: "PATCH", body: JSON.stringify(body) });
      setCompleteConfirmOpen(false);
      setCompleteMessage(`Auction for ${assetLabel(selectedAuction.assetId)} completion submitted — sale proceeds of ${formatMoney(rupeesToMinorString(saleProceeds))} recorded pending processing.`);
      setAuctionId("");
      onDone();
    } catch (err) {
      setCompleteDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setCompleteBusy(false);
    }
  }

  // GAP-ASSETS-CONDEMNATION-04: the reserve is prefilled from the approved
  // recommendation; flag it when the clerk overrides that figure.
  const enteredReserve = rupeesToMinorString(reserveValue);
  const reserveDiffers = !!selectedRec?.reserveValueMinor && enteredReserve !== null && enteredReserve !== selectedRec.reserveValueMinor;

  return (
    <Card title="3. Auction">
      <div className="pad" style={{ display: "grid", gap: 18 }}>
        <div style={{ display: "grid", gap: 14 }}>
          <h4 style={{ margin: 0 }}>Create auction</h4>
          {grid(
            <>
              <Field id={recommendationIdField} label="Approved recommendation" error={errors.recommendationId}>
                <SelectInput
                  id={recommendationIdField}
                  selectRef={recRef}
                  value={recommendationId}
                  onChange={pickRecommendation}
                  error={errors.recommendationId}
                  options={auctionableRecs.map((r) => ({ value: r.id, label: recLabel(r) }))}
                  emptyLabel={emptyText(data.failed.recommendations, "No approved condemnations")}
                />
              </Field>
              <Field id={reserveField} label="Reserve value (₹)" error={errors.reserveValue}>
                <TextInput id={reserveField} inputRef={reserveRef} value={reserveValue} onChange={setReserveValue} inputMode="decimal" error={errors.reserveValue} />
                {reserveDiffers && selectedRec && (
                  <p role="status" style={{ fontSize: 12, color: "var(--warn)", margin: 0 }}>
                    The approved recommendation set a reserve of {formatMoney(selectedRec.reserveValueMinor)}; this auction uses a different figure.
                  </p>
                )}
              </Field>
              <Field id={dateField} label="Auction date" required={false} error={errors.auctionDate}>
                <TextInput id={dateField} type="date" inputRef={auctionDateRef} value={auctionDate} onChange={setAuctionDate} required={false} error={errors.auctionDate} />
              </Field>
            </>,
          )}
          <div>
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                setMessage(null);
                if (!validateCreate()) return;
                setDialogError(undefined);
                setConfirmOpen(true);
              }}
            >
              Create Auction
            </Button>
          </div>
          {message && <p role="status" className="pill good" style={{ width: "fit-content" }}>{message}</p>}
        </div>

        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, display: "grid", gap: 14 }}>
          <h4 style={{ margin: 0 }}>Complete auction</h4>
          {grid(
            <>
              <Field id={auctionIdField} label="Open auction" error={completeErrors.auctionId}>
                <SelectInput
                  id={auctionIdField}
                  selectRef={auctionIdRef}
                  value={auctionId}
                  onChange={setAuctionId}
                  error={completeErrors.auctionId}
                  options={openAuctions.map((a) => ({ value: a.id, label: auctionLabel(a) }))}
                  emptyLabel={emptyText(data.failed.auctions, "No open auctions")}
                />
              </Field>
              <Field id={bidField} label="Winning bid (₹)" error={completeErrors.highestBid}>
                <TextInput id={bidField} inputRef={bidRef} value={highestBid} onChange={setHighestBid} inputMode="decimal" error={completeErrors.highestBid} />
              </Field>
              <Field id={winnerField} label="Winner name" error={completeErrors.winnerName}>
                <TextInput id={winnerField} inputRef={winnerRef2} value={winnerName} onChange={setWinnerName} error={completeErrors.winnerName} />
              </Field>
              {/* GAP-ASSETS-CONDEMNATION-06 (DPDP): ask for a bidder registration /
                  contact reference -- not a PAN. The value is write-only (never echoed). */}
              <Field id={winnerRefField} label="Bidder registration / contact reference" required={false}>
                <TextInput id={winnerRefField} value={winnerRef} onChange={setWinnerRef} placeholder="Auction registration no. (optional)" required={false} />
                <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
                  Kept only as part of the auction record. Do not enter a PAN or other identity number unless the auction rules require it.
                </p>
              </Field>
              <Field id={proceedsField} label="Sale proceeds (₹)" error={completeErrors.saleProceeds}>
                <TextInput id={proceedsField} inputRef={proceedsRef} value={saleProceeds} onChange={setSaleProceeds} inputMode="decimal" error={completeErrors.saleProceeds} />
              </Field>
            </>,
          )}
          <div>
            <Button
              type="button"
              variant="danger"
              disabled={completeBusy}
              onClick={() => {
                setCompleteMessage(null);
                if (!validateComplete()) return;
                setCompleteDialogError(undefined);
                setCompleteConfirmOpen(true);
              }}
            >
              Complete Auction
            </Button>
          </div>
          {completeMessage && <p role="status" className="pill good" style={{ width: "fit-content" }}>{completeMessage}</p>}
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Create this auction?"
        confirmLabel="Create auction"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Opens an auction for <strong>{selectedRec ? assetLabel(selectedRec.assetId) : "—"}</strong> with reserve value{" "}
            <strong>{formatMoney(rupeesToMinorString(reserveValue))}</strong>.
          </>
        }
        onConfirm={() => void createAuction()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />

      <ConfirmDialog
        open={completeConfirmOpen}
        title="Complete this auction?"
        confirmLabel="Complete auction"
        danger
        busy={completeBusy}
        errorMessage={completeDialogError}
        description={
          <>
            Records the auction for <strong>{selectedAuction ? assetLabel(selectedAuction.assetId) : "—"}</strong> (reserve{" "}
            {formatMoney(selectedAuction?.reserveValueMinor)}) as won by <strong>{winnerName || "—"}</strong> for{" "}
            <strong>{formatMoney(rupeesToMinorString(highestBid))}</strong>, with sale proceeds of{" "}
            <strong>{formatMoney(rupeesToMinorString(saleProceeds))}</strong> posted to Finance. The asset is retired. This
            is <strong>irreversible</strong> from this screen.
          </>
        }
        onConfirm={() => void completeAuction()}
        onCancel={() => !completeBusy && setCompleteConfirmOpen(false)}
      />
    </Card>
  );
}

// ── orchestrator ───────────────────────────────────────────────────────

export function CondemnationWorkflow({ data = EMPTY }: { data?: CondemnationData }) {
  const router = useRouter();
  // Re-read the server lists after each accepted command so the next step's
  // picker shows the record once the consumer has applied it.
  const refresh = () => router.refresh();
  const anyFailed = Object.values(data.failed).some(Boolean);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {anyFailed ? (
        <p role="alert" className="pill bad" style={{ width: "fit-content", margin: 0 }}>
          Some condemnation records couldn&apos;t be loaded, so a picker may be incomplete. Refresh to retry.
        </p>
      ) : null}
      <SurveyPanel data={data} onDone={refresh} />
      <RecommendationPanel data={data} onDone={refresh} />
      <AuctionPanel data={data} onDone={refresh} />
    </div>
  );
}
