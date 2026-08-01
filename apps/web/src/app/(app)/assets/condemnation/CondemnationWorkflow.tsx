"use client";

/**
 * Condemnation → committee recommendation (maker-checker) → auction workflow.
 *
 * The asset-service condemnation module (services/asset-service/src/modules/
 * condemnation/routes.ts) exposes ONLY command endpoints — POST/PATCH, every
 * one answered 202 "accepted" — with no GET for a survey, recommendation, or
 * auction by id and no list. There is nothing to fetch and pre-validate
 * against, so each panel below is a self-contained command form. A
 * successful create carries its returned id forward into the next panel's
 * field (editable, so a workflow started elsewhere can be resumed by pasting
 * in an id) rather than pretending to "look up" a record that this service
 * cannot return.
 *
 * Maker-checker on recommendation approval (approver ≠ creator) is enforced
 * server-side, asynchronously, in the queue consumer — the HTTP response is
 * only ever "accepted", never "approved". The UI must not claim otherwise.
 */
import { useId, useRef, useState, type ReactNode } from "react";
import { Card, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney } from "@/lib/formatters";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);

type Accepted = { id: string; status: string; correlationId: string };

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
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  placeholder?: string;
  required?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <input
      id={id}
      ref={inputRef}
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
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  error?: string;
  selectRef?: React.Ref<HTMLSelectElement>;
}) {
  return (
    <select
      id={id}
      ref={selectRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-required="true"
      aria-invalid={!!error || undefined}
      aria-describedby={error ? `${id}-err` : undefined}
      style={inputStyle}
    >
      <option value="">Select…</option>
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

// ── Survey panel ───────────────────────────────────────────────────────────

function SurveyPanel({
  onSurveyCreated,
  assetId,
  setAssetId,
}: {
  onSurveyCreated: (id: string, assetId: string) => void;
  assetId: string;
  setAssetId: (v: string) => void;
}) {
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

  const [submitVersion, setSubmitVersion] = useState("1");
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
  const versionField = useId();
  const recommendationField = useId();

  const assetRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const conditionRef = useRef<HTMLSelectElement>(null);
  const repairRef = useRef<HTMLInputElement>(null);
  const surveyIdRef = useRef<HTMLInputElement>(null);
  const versionRef = useRef<HTMLInputElement>(null);

  function validateCreate(): boolean {
    const next: Record<string, string> = {};
    if (!UUID_PATTERN.test(assetId.trim())) next.assetId = "Enter a valid asset ID (UUID).";
    if (!DATE_PATTERN.test(surveyDate.trim())) next.surveyDate = "Survey date must be YYYY-MM-DD.";
    if (!condition) next.condition = "Select the condemnation condition.";
    if (repairCost.trim() && rupeesToMinorString(repairCost) === null) {
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
      const body: Record<string, unknown> = {
        assetId: assetId.trim(),
        surveyDate: surveyDate.trim(),
        condition,
        currency: "INR",
      };
      if (conditionNotes.trim()) body.conditionNotes = conditionNotes.trim();
      if (yearsInUse.trim()) body.yearsInUse = Number(yearsInUse);
      if (repairCost.trim()) body.estimatedRepairCostMinor = Number(rupeesToMinorString(repairCost));
      const res = await browserJson<Accepted>("v1/asset/condemnation-surveys", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setConfirmOpen(false);
      setSurveyId(res.id);
      setMessage(`Survey submitted — tracking id ${res.id}. It will be recorded once the queue consumer processes it.`);
      onSurveyCreated(res.id, assetId.trim());
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function validateSubmit(): boolean {
    const next: Record<string, string> = {};
    if (!UUID_PATTERN.test(surveyId.trim())) next.surveyId = "Enter a valid survey ID (UUID) — created above or pasted in.";
    if (!/^\d+$/.test(submitVersion.trim()) || Number(submitVersion) < 1) next.submitVersion = "Enter the survey's current version (a positive integer).";
    if (!submitRecommendation) next.submitRecommendation = "Select the survey recommendation.";
    setSubmitErrors(next);
    if (next.surveyId) { surveyIdRef.current?.focus(); return false; }
    if (next.submitVersion) { versionRef.current?.focus(); return false; }
    return Object.keys(next).length === 0;
  }

  async function submitSurvey() {
    setSubmitBusy(true);
    setSubmitDialogError(undefined);
    try {
      const res = await browserJson<Accepted>(`v1/asset/condemnation-surveys/${surveyId.trim()}/submit`, {
        method: "PATCH",
        body: JSON.stringify({ version: Number(submitVersion), recommendation: submitRecommendation }),
      });
      setSubmitConfirmOpen(false);
      setSubmitMessage(`Survey ${res.id.slice(0, 8)}… submitted with recommendation "${submitRecommendation}".`);
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
              <Field id={assetIdField} label="Asset ID" error={errors.assetId}>
                <TextInput id={assetIdField} inputRef={assetRef} value={assetId} onChange={setAssetId} placeholder="UUID from the Asset Register" error={errors.assetId} />
              </Field>
              <Field id={surveyDateField} label="Survey date" error={errors.surveyDate}>
                <TextInput id={surveyDateField} inputRef={dateRef} value={surveyDate} onChange={setSurveyDate} placeholder="YYYY-MM-DD" error={errors.surveyDate} />
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
            <textarea
              id={notesField}
              value={conditionNotes}
              onChange={(e) => setConditionNotes(e.target.value)}
              rows={2}
              style={{ ...inputStyle, minHeight: 60 }}
            />
          </Field>
          <div>
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => {
                setMessage(null);
                if (!validateCreate()) return;
                setDialogError(undefined);
                setConfirmOpen(true);
              }}
            >
              Create Survey
            </button>
          </div>
          {message && <p role="status" className="pill good" style={{ width: "fit-content" }}>{message}</p>}
        </div>

        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, display: "grid", gap: 14 }}>
          <h4 style={{ margin: 0 }}>Submit survey</h4>
          {grid(
            <>
              <Field id={surveyIdField} label="Survey ID" error={submitErrors.surveyId}>
                <TextInput id={surveyIdField} inputRef={surveyIdRef} value={surveyId} onChange={setSurveyId} placeholder="UUID returned above" error={submitErrors.surveyId} />
              </Field>
              <Field id={versionField} label="Current version" error={submitErrors.submitVersion}>
                <TextInput id={versionField} inputRef={versionRef} value={submitVersion} onChange={setSubmitVersion} inputMode="numeric" error={submitErrors.submitVersion} />
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
            <button
              type="button"
              className="btn ghost"
              disabled={submitBusy}
              onClick={() => {
                setSubmitMessage(null);
                if (!validateSubmit()) return;
                setSubmitDialogError(undefined);
                setSubmitConfirmOpen(true);
              }}
            >
              Submit Survey
            </button>
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
            Records a condemnation survey for asset <strong className="mono">{assetId.slice(0, 8)}…</strong> with
            condition <strong>{condition || "—"}</strong>.
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
            Submits survey <strong className="mono">{surveyId.slice(0, 8)}…</strong> with recommendation{" "}
            <strong>{submitRecommendation || "—"}</strong>. This locks the survey against further edits.
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

function RecommendationPanel({
  surveyId,
  setSurveyId,
  assetId,
  setAssetId,
  onRecommendationCreated,
}: {
  surveyId: string;
  setSurveyId: (v: string) => void;
  assetId: string;
  setAssetId: (v: string) => void;
  onRecommendationCreated: (id: string) => void;
}) {
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

  const [approveVersion, setApproveVersion] = useState("1");
  const [approveErrors, setApproveErrors] = useState<Record<string, string>>({});
  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false);
  const [approveBusy, setApproveBusy] = useState(false);
  const [approveDialogError, setApproveDialogError] = useState<string | undefined>();
  const [approveMessage, setApproveMessage] = useState<string | null>(null);

  const surveyIdField = useId();
  const assetIdField = useId();
  const decisionField = useId();
  const reasonField = useId();
  const reserveField = useId();
  const floorField = useId();
  const recommendationIdField = useId();
  const approveVersionField = useId();

  const surveyRef = useRef<HTMLInputElement>(null);
  const assetRef = useRef<HTMLInputElement>(null);
  const decisionRef = useRef<HTMLSelectElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const firstMemberRef = useRef<HTMLInputElement>(null);
  const reserveRef = useRef<HTMLInputElement>(null);
  const floorRef = useRef<HTMLInputElement>(null);
  const recIdRef = useRef<HTMLInputElement>(null);
  const approveVersionRef = useRef<HTMLInputElement>(null);

  function updateMember(i: number, patch: Partial<CommitteeMember>) {
    setMembers((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  }

  function validateCreate(): boolean {
    const next: Record<string, string> = {};
    if (!UUID_PATTERN.test(surveyId.trim())) next.surveyId = "Enter a valid survey ID (UUID).";
    if (!UUID_PATTERN.test(assetId.trim())) next.assetId = "Enter a valid asset ID (UUID).";
    if (!decision) next.decision = "Select the committee's decision.";
    if (!reason.trim()) next.reason = "Enter the committee's reason.";
    const validMembers = members.filter((m) => m.name.trim() && m.designation.trim());
    if (validMembers.length < 2) next.members = "At least 2 committee members (name + designation) are required.";
    if (reserveValue.trim() && rupeesToMinorString(reserveValue) === null) next.reserveValue = "Enter a valid non-negative reserve value (₹).";
    if (floorValue.trim() && rupeesToMinorString(floorValue) === null) next.floorValue = "Enter a valid non-negative floor value (₹).";
    setErrors(next);
    if (next.surveyId) { surveyRef.current?.focus(); return false; }
    if (next.assetId) { assetRef.current?.focus(); return false; }
    if (next.decision) { decisionRef.current?.focus(); return false; }
    if (next.reason) { reasonRef.current?.focus(); return false; }
    if (next.members) { firstMemberRef.current?.focus(); return false; }
    if (next.reserveValue) { reserveRef.current?.focus(); return false; }
    if (next.floorValue) { floorRef.current?.focus(); return false; }
    return Object.keys(next).length === 0;
  }

  async function createRecommendation() {
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
        surveyId: surveyId.trim(),
        assetId: assetId.trim(),
        committeeMembers,
        decision,
        reason: reason.trim(),
        currency: "INR",
      };
      if (reserveValue.trim()) body.reserveValueMinor = Number(rupeesToMinorString(reserveValue));
      if (floorValue.trim()) body.floorValueMinor = Number(rupeesToMinorString(floorValue));
      const res = await browserJson<Accepted>("v1/asset/condemnation-recommendations", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setConfirmOpen(false);
      setRecommendationId(res.id);
      setMessage(`Recommendation submitted — tracking id ${res.id}.`);
      onRecommendationCreated(res.id);
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function validateApprove(): boolean {
    const next: Record<string, string> = {};
    if (!UUID_PATTERN.test(recommendationId.trim())) next.recommendationId = "Enter a valid recommendation ID (UUID) — created above or pasted in.";
    if (!/^\d+$/.test(approveVersion.trim()) || Number(approveVersion) < 1) next.approveVersion = "Enter the recommendation's current version (a positive integer).";
    setApproveErrors(next);
    if (next.recommendationId) { recIdRef.current?.focus(); return false; }
    if (next.approveVersion) { approveVersionRef.current?.focus(); return false; }
    return Object.keys(next).length === 0;
  }

  async function approveRecommendation() {
    setApproveBusy(true);
    setApproveDialogError(undefined);
    try {
      const res = await browserJson<Accepted>(`v1/asset/condemnation-recommendations/${recommendationId.trim()}/approve`, {
        method: "PATCH",
        body: JSON.stringify({ version: Number(approveVersion) }),
      });
      setApproveConfirmOpen(false);
      // Fail-closed: the maker≠checker check runs asynchronously in the queue
      // consumer, not in this HTTP response — a 202 means "accepted for
      // processing", never "approved". Never claim approval happened.
      setApproveMessage(`Approval submitted for recommendation ${res.id.slice(0, 8)}… — pending the checker's maker≠checker verification.`);
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
              <Field id={surveyIdField} label="Survey ID" error={errors.surveyId}>
                <TextInput id={surveyIdField} inputRef={surveyRef} value={surveyId} onChange={setSurveyId} placeholder="UUID from the survey above" error={errors.surveyId} />
              </Field>
              <Field id={assetIdField} label="Asset ID" error={errors.assetId}>
                <TextInput id={assetIdField} inputRef={assetRef} value={assetId} onChange={setAssetId} placeholder="UUID from the Asset Register" error={errors.assetId} />
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
              <div key={i} style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr 1fr", alignItems: "start" }}>
                <Field id={`member-${i}-name`} label={`Member ${i + 1} name`} required={false}>
                  <TextInput
                    id={`member-${i}-name`}
                    inputRef={i === 0 ? firstMemberRef : undefined}
                    value={m.name}
                    onChange={(v) => updateMember(i, { name: v })}
                    required={false}
                  />
                </Field>
                <Field id={`member-${i}-designation`} label={`Member ${i + 1} designation`} required={false}>
                  <TextInput
                    id={`member-${i}-designation`}
                    value={m.designation}
                    onChange={(v) => updateMember(i, { designation: v })}
                    required={false}
                  />
                </Field>
                <Field id={`member-${i}-employeeRef`} label={`Member ${i + 1} employee ref`} required={false}>
                  <TextInput
                    id={`member-${i}-employeeRef`}
                    value={m.employeeRef}
                    onChange={(v) => updateMember(i, { employeeRef: v })}
                    placeholder="UUID, optional"
                    required={false}
                  />
                </Field>
              </div>
            ))}
            {errors.members && <p role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.members}</p>}
            <div>
              <button type="button" className="btn ghost sm" onClick={() => setMembers((prev) => [...prev, emptyMember()])}>
                + Add member
              </button>
            </div>
          </div>

          <div>
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => {
                setMessage(null);
                if (!validateCreate()) return;
                setDialogError(undefined);
                setConfirmOpen(true);
              }}
            >
              Create Recommendation
            </button>
          </div>
          {message && <p role="status" className="pill good" style={{ width: "fit-content" }}>{message}</p>}
        </div>

        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, display: "grid", gap: 14 }}>
          <h4 style={{ margin: 0 }}>Approve recommendation</h4>
          <p style={{ margin: 0, fontSize: 12, color: "var(--ink2)" }}>
            The approving officer must be different from the officer who created the recommendation — the server
            rejects same-user maker-checker decisions asynchronously; this UI cannot pre-check that.
          </p>
          {grid(
            <>
              <Field id={recommendationIdField} label="Recommendation ID" error={approveErrors.recommendationId}>
                <TextInput id={recommendationIdField} inputRef={recIdRef} value={recommendationId} onChange={setRecommendationId} placeholder="UUID returned above" error={approveErrors.recommendationId} />
              </Field>
              <Field id={approveVersionField} label="Current version" error={approveErrors.approveVersion}>
                <TextInput id={approveVersionField} inputRef={approveVersionRef} value={approveVersion} onChange={setApproveVersion} inputMode="numeric" error={approveErrors.approveVersion} />
              </Field>
            </>,
          )}
          <div>
            <button
              type="button"
              className="btn danger"
              disabled={approveBusy}
              onClick={() => {
                setApproveMessage(null);
                if (!validateApprove()) return;
                setApproveDialogError(undefined);
                setApproveConfirmOpen(true);
              }}
            >
              Approve Recommendation
            </button>
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
            Records the committee's <strong>{decision || "—"}</strong> decision for asset{" "}
            <strong className="mono">{assetId.slice(0, 8)}…</strong>.
          </>
        }
        onConfirm={() => void createRecommendation()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />

      <ConfirmDialog
        open={approveConfirmOpen}
        title="Approve this condemnation recommendation?"
        confirmLabel="Submit approval"
        danger
        busy={approveBusy}
        errorMessage={approveDialogError}
        description={
          <>
            Submits your approval of recommendation <strong className="mono">{recommendationId.slice(0, 8)}…</strong>
            {assetId.trim() ? (
              <>
                {" "}for asset <strong className="mono">{assetId.trim().slice(0, 8)}…</strong>
              </>
            ) : null}{" "}
            for server-side maker-checker verification (approver must differ from creator).
            {(reserveValue.trim() || floorValue.trim()) ? (
              <>
                {" "}Reserve value{" "}
                <strong>{reserveValue.trim() ? formatMoney(Number(rupeesToMinorString(reserveValue) ?? "0")) : "—"}</strong>
                {" "}· floor value{" "}
                <strong>{floorValue.trim() ? formatMoney(Number(rupeesToMinorString(floorValue) ?? "0")) : "—"}</strong>.
              </>
            ) : null}{" "}
            On approval the asset moves toward condemnation — this cannot be undone from this screen.
          </>
        }
        onConfirm={() => void approveRecommendation()}
        onCancel={() => !approveBusy && setApproveConfirmOpen(false)}
      />
    </Card>
  );
}

// ── Auction panel ──────────────────────────────────────────────────────

function AuctionPanel({
  assetId,
  setAssetId,
  recommendationId,
  setRecommendationId,
}: {
  assetId: string;
  setAssetId: (v: string) => void;
  recommendationId: string;
  setRecommendationId: (v: string) => void;
}) {
  const [reserveValue, setReserveValue] = useState("");
  const [auctionDate, setAuctionDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [auctionId, setAuctionId] = useState("");

  const [completeVersion, setCompleteVersion] = useState("1");
  const [highestBid, setHighestBid] = useState("");
  const [winnerName, setWinnerName] = useState("");
  const [winnerRef, setWinnerRef] = useState("");
  const [saleProceeds, setSaleProceeds] = useState("");
  const [completeErrors, setCompleteErrors] = useState<Record<string, string>>({});
  const [completeConfirmOpen, setCompleteConfirmOpen] = useState(false);
  const [completeBusy, setCompleteBusy] = useState(false);
  const [completeDialogError, setCompleteDialogError] = useState<string | undefined>();
  const [completeMessage, setCompleteMessage] = useState<string | null>(null);

  const assetIdField = useId();
  const recommendationIdField = useId();
  const reserveField = useId();
  const dateField = useId();
  const auctionIdField = useId();
  const versionField = useId();
  const bidField = useId();
  const winnerField = useId();
  const winnerRefField = useId();
  const proceedsField = useId();

  const assetRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<HTMLInputElement>(null);
  const reserveRef = useRef<HTMLInputElement>(null);
  const auctionDateRef = useRef<HTMLInputElement>(null);
  const auctionIdRef = useRef<HTMLInputElement>(null);
  const versionRef = useRef<HTMLInputElement>(null);
  const bidRef = useRef<HTMLInputElement>(null);
  const winnerRef2 = useRef<HTMLInputElement>(null);
  const proceedsRef = useRef<HTMLInputElement>(null);

  function validateCreate(): boolean {
    const next: Record<string, string> = {};
    if (!UUID_PATTERN.test(assetId.trim())) next.assetId = "Enter a valid asset ID (UUID).";
    if (!UUID_PATTERN.test(recommendationId.trim())) next.recommendationId = "Enter a valid recommendation ID (UUID).";
    const reserveMinor = rupeesToMinorString(reserveValue);
    if (!reserveValue.trim() || reserveMinor === null) next.reserveValue = "Enter a valid positive reserve value (₹).";
    if (auctionDate.trim() && !DATE_PATTERN.test(auctionDate.trim())) next.auctionDate = "Auction date must be YYYY-MM-DD.";
    setErrors(next);
    if (next.assetId) { assetRef.current?.focus(); return false; }
    if (next.recommendationId) { recRef.current?.focus(); return false; }
    if (next.reserveValue) { reserveRef.current?.focus(); return false; }
    if (next.auctionDate) { auctionDateRef.current?.focus(); return false; }
    return Object.keys(next).length === 0;
  }

  async function createAuction() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const body: Record<string, unknown> = {
        assetId: assetId.trim(),
        recommendationId: recommendationId.trim(),
        reserveValueMinor: Number(rupeesToMinorString(reserveValue)),
        currency: "INR",
      };
      if (auctionDate.trim()) body.auctionDate = auctionDate.trim();
      const res = await browserJson<Accepted>("v1/asset/auctions", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setConfirmOpen(false);
      setAuctionId(res.id);
      setMessage(`Auction created — tracking id ${res.id}.`);
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function validateComplete(): boolean {
    const next: Record<string, string> = {};
    if (!UUID_PATTERN.test(auctionId.trim())) next.auctionId = "Enter a valid auction ID (UUID) — created above or pasted in.";
    if (!/^\d+$/.test(completeVersion.trim()) || Number(completeVersion) < 1) next.completeVersion = "Enter the auction's current version (a positive integer).";
    const bidMinor = rupeesToMinorString(highestBid);
    if (!highestBid.trim() || bidMinor === null) next.highestBid = "Enter a valid positive winning bid (₹).";
    if (!winnerName.trim()) next.winnerName = "Enter the winning bidder's name.";
    const proceedsMinor = rupeesToMinorString(saleProceeds);
    if (!saleProceeds.trim() || proceedsMinor === null) next.saleProceeds = "Enter valid positive sale proceeds (₹).";
    setCompleteErrors(next);
    if (next.auctionId) { auctionIdRef.current?.focus(); return false; }
    if (next.completeVersion) { versionRef.current?.focus(); return false; }
    if (next.highestBid) { bidRef.current?.focus(); return false; }
    if (next.winnerName) { winnerRef2.current?.focus(); return false; }
    if (next.saleProceeds) { proceedsRef.current?.focus(); return false; }
    return Object.keys(next).length === 0;
  }

  async function completeAuction() {
    setCompleteBusy(true);
    setCompleteDialogError(undefined);
    try {
      const body: Record<string, unknown> = {
        version: Number(completeVersion),
        highestBidMinor: Number(rupeesToMinorString(highestBid)),
        winnerName: winnerName.trim(),
        saleProceedsMinor: Number(rupeesToMinorString(saleProceeds)),
      };
      if (winnerRef.trim()) body.winnerRef = winnerRef.trim();
      const res = await browserJson<Accepted>(`v1/asset/auctions/${auctionId.trim()}/complete`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setCompleteConfirmOpen(false);
      setCompleteMessage(`Auction ${res.id.slice(0, 8)}… completion submitted — sale proceeds of ${formatMoney(Number(rupeesToMinorString(saleProceeds) ?? "0"))} recorded pending processing.`);
    } catch (err) {
      setCompleteDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setCompleteBusy(false);
    }
  }

  return (
    <Card title="3. Auction">
      <div className="pad" style={{ display: "grid", gap: 18 }}>
        <div style={{ display: "grid", gap: 14 }}>
          <h4 style={{ margin: 0 }}>Create auction</h4>
          {grid(
            <>
              <Field id={assetIdField} label="Asset ID" error={errors.assetId}>
                <TextInput id={assetIdField} inputRef={assetRef} value={assetId} onChange={setAssetId} placeholder="UUID from the Asset Register" error={errors.assetId} />
              </Field>
              <Field id={recommendationIdField} label="Recommendation ID" error={errors.recommendationId}>
                <TextInput id={recommendationIdField} inputRef={recRef} value={recommendationId} onChange={setRecommendationId} placeholder="UUID from the recommendation above" error={errors.recommendationId} />
              </Field>
              <Field id={reserveField} label="Reserve value (₹)" error={errors.reserveValue}>
                <TextInput id={reserveField} inputRef={reserveRef} value={reserveValue} onChange={setReserveValue} inputMode="decimal" error={errors.reserveValue} />
              </Field>
              <Field id={dateField} label="Auction date" required={false} error={errors.auctionDate}>
                <TextInput id={dateField} inputRef={auctionDateRef} value={auctionDate} onChange={setAuctionDate} placeholder="YYYY-MM-DD" required={false} error={errors.auctionDate} />
              </Field>
            </>,
          )}
          <div>
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => {
                setMessage(null);
                if (!validateCreate()) return;
                setDialogError(undefined);
                setConfirmOpen(true);
              }}
            >
              Create Auction
            </button>
          </div>
          {message && <p role="status" className="pill good" style={{ width: "fit-content" }}>{message}</p>}
        </div>

        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, display: "grid", gap: 14 }}>
          <h4 style={{ margin: 0 }}>Complete auction</h4>
          {grid(
            <>
              <Field id={auctionIdField} label="Auction ID" error={completeErrors.auctionId}>
                <TextInput id={auctionIdField} inputRef={auctionIdRef} value={auctionId} onChange={setAuctionId} placeholder="UUID returned above" error={completeErrors.auctionId} />
              </Field>
              <Field id={versionField} label="Current version" error={completeErrors.completeVersion}>
                <TextInput id={versionField} inputRef={versionRef} value={completeVersion} onChange={setCompleteVersion} inputMode="numeric" error={completeErrors.completeVersion} />
              </Field>
              <Field id={bidField} label="Winning bid (₹)" error={completeErrors.highestBid}>
                <TextInput id={bidField} inputRef={bidRef} value={highestBid} onChange={setHighestBid} inputMode="decimal" error={completeErrors.highestBid} />
              </Field>
              <Field id={winnerField} label="Winner name" error={completeErrors.winnerName}>
                <TextInput id={winnerField} inputRef={winnerRef2} value={winnerName} onChange={setWinnerName} error={completeErrors.winnerName} />
              </Field>
              <Field id={winnerRefField} label="Winner reference" required={false}>
                <TextInput id={winnerRefField} value={winnerRef} onChange={setWinnerRef} placeholder="PAN / contact ref (optional)" required={false} />
              </Field>
              <Field id={proceedsField} label="Sale proceeds (₹)" error={completeErrors.saleProceeds}>
                <TextInput id={proceedsField} inputRef={proceedsRef} value={saleProceeds} onChange={setSaleProceeds} inputMode="decimal" error={completeErrors.saleProceeds} />
              </Field>
            </>,
          )}
          <div>
            <button
              type="button"
              className="btn danger"
              disabled={completeBusy}
              onClick={() => {
                setCompleteMessage(null);
                if (!validateComplete()) return;
                setCompleteDialogError(undefined);
                setCompleteConfirmOpen(true);
              }}
            >
              Complete Auction
            </button>
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
            Opens an auction for asset <strong className="mono">{assetId.slice(0, 8)}…</strong> with reserve value{" "}
            <strong>{formatMoney(Number(rupeesToMinorString(reserveValue) ?? "0"))}</strong>.
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
            Records auction <strong className="mono">{auctionId.slice(0, 8)}…</strong> as won by{" "}
            <strong>{winnerName || "—"}</strong> for{" "}
            <strong>{formatMoney(Number(rupeesToMinorString(highestBid) ?? "0"))}</strong>, with sale proceeds of{" "}
            <strong>{formatMoney(Number(rupeesToMinorString(saleProceeds) ?? "0"))}</strong> posted to the register.
            This is <strong>irreversible</strong> from this screen.
          </>
        }
        onConfirm={() => void completeAuction()}
        onCancel={() => !completeBusy && setCompleteConfirmOpen(false)}
      />
    </Card>
  );
}

// ── orchestrator ───────────────────────────────────────────────────────

export function CondemnationWorkflow() {
  const [assetId, setAssetId] = useState("");
  const [surveyId, setSurveyId] = useState("");
  const [recommendationId, setRecommendationId] = useState("");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <SurveyPanel
        assetId={assetId}
        setAssetId={setAssetId}
        onSurveyCreated={(id, createdAssetId) => {
          setSurveyId(id);
          setAssetId(createdAssetId);
        }}
      />
      <RecommendationPanel
        surveyId={surveyId}
        setSurveyId={setSurveyId}
        assetId={assetId}
        setAssetId={setAssetId}
        onRecommendationCreated={setRecommendationId}
      />
      <AuctionPanel
        assetId={assetId}
        setAssetId={setAssetId}
        recommendationId={recommendationId}
        setRecommendationId={setRecommendationId}
      />
    </div>
  );
}
