"use client";

/**
 * RaiseEOfficeNote — drop-in, reusable in-module eOffice integration control.
 *
 * Shows the current eOffice file status for a business entity (sanction, PO,
 * transfer, grant, …) and lets an officer raise it for formal, immutable,
 * auditable approval. The amount drives automatic routing through the eOffice
 * approval matrix; an explicit approval chain is used as the fallback.
 *
 * Usage:
 *   <RaiseEOfficeNote
 *     refType="finance_sanction"
 *     refId={sanction.id}
 *     subject={sanction.subject}
 *     dept="Finance"
 *     amountMinor={sanction.amount}
 *     defaultApprovalChain="finance.sanction.standard"
 *   />
 */

import { useCallback, useEffect, useState } from "react";
import { Button, Field, Select, StatusPill, type EntityOption } from "./ds";
import { EmployeePicker } from "./EmployeePicker";
import { useSelfEmployee } from "./useSelfEmployee";
import { errorMessageFromResponse } from "@/lib/api/browserClient";
import { toHumanError } from "@/lib/messages";
import { isEofficeFileInFlight } from "./eofficeFileStatus";

export type RaiseEOfficeNoteProps = {
  refType: string;
  refId: string;
  subject: string;
  dept: string;
  /** Decision-relevant amount in minor units (paise); drives matrix routing.
   *  Accepts a bigint-safe decimal string (the convention this codebase's
   *  money fields use, e.g. SanctionDetail.amount) as well as a plain
   *  number — this component only forwards it in `context`, it never does
   *  arithmetic on it locally. */
  amountMinor?: number | string;
  /** Fallback workflow definition code when no matrix rule matches. */
  defaultApprovalChain?: string;
  classification?: "top_secret" | "secret" | "confidential" | "public";
  priority?: "normal" | "urgent" | "immediate";
  /**
   * Optional source-module endpoint (proxy path) called after a successful
   * raise so the originating entity can move to "pending approval". Closes the
   * loop visually until the eOffice decision callback lands.
   */
  notifyPath?: string;
  /**
   * When true the notify POST carries the raised file number (`{ fileNo }`), so the
   * source service can record WHICH file is deciding the record (finance sanctions
   * use it to refuse a direct approve while the file is in flight). Off by default:
   * other callers keep the empty body.
   */
  notifyWithFileNo?: boolean;
  /**
   * Optional (GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-01): reports the linked
   * eFile lookup to a parent that needs to react to it (e.g. hide a competing
   * direct-approve button). Called whenever the lookup settles; pages that do
   * not pass it behave exactly as before.
   */
  onLinkedFileChange?: (state: { loading: boolean; file: LinkedFile | null }) => void;
  /**
   * Opt-in: when the linked file is no longer in flight (e.g. rejected or
   * closed) offer "Raise for approval" again instead of locking the record
   * behind a dead file. Default off, so the other pages keep today's behaviour.
   */
  allowRaiseAfterTerminal?: boolean;
};

export type LinkedFile = {
  id: string;
  file_no: string;
  status: string;
};

/** Classification options shown to the officer (GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-03). */
const CLASSIFICATION_OPTIONS: { value: NonNullable<RaiseEOfficeNoteProps["classification"]>; label: string }[] = [
  { value: "public", label: "Public" },
  { value: "confidential", label: "Confidential" },
  { value: "secret", label: "Secret" },
  { value: "top_secret", label: "Top secret" },
];

/** A failed raise whose message is already plain-language (safe to show). */
class RaiseFailed extends Error {}

export function RaiseEOfficeNote(props: RaiseEOfficeNoteProps) {
  const {
    refType, refId, subject, dept,
    amountMinor, defaultApprovalChain = "estab.generic.standard",
    classification: classificationProp = "confidential", priority = "normal",
    notifyPath, notifyWithFileNo = false, onLinkedFileChange, allowRaiseAfterTerminal = false,
  } = props;

  const [file, setFile] = useState<LinkedFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [warning, setWarning] = useState("");
  // The classification the officer sees and can change; seeded from the prop.
  const [classification, setClassification] = useState<NonNullable<RaiseEOfficeNoteProps["classification"]>>(classificationProp);

  // GAP-HR-DISCIPLINARY-DETAIL-05: these were raw free-text UUID inputs with
  // no entity picker and no validation beyond "looks like a UUID" -- a
  // clerk had to already know (or copy-paste from elsewhere) the exact id
  // of the officer they meant. EntityPicker replaces both with a
  // debounced, named search over the same employee directory used
  // elsewhere in the app (GAP-HR-SF-06); `value`/`onChange` still carry a
  // plain id string, so `submit` below is otherwise unchanged.
  const [initiatedBy, setInitiatedBy] = useState<string | null>(null);
  const [currentWith, setCurrentWith] = useState<string | null>(null);
  // GAP-FINANCE-PAYMENTS-DETAIL-02: names of the chosen officers, so the success message can say WHO
  // initiated and who it went to (a person, not an id), and the signed-in user as the default initiator.
  const [initiatedOption, setInitiatedOption] = useState<EntityOption | null>(null);
  const [currentWithOption, setCurrentWithOption] = useState<EntityOption | null>(null);
  // Remounts the initiator picker once, when the signed-in user is applied as the default, so it shows that name.
  const [selfDefaultId, setSelfDefaultId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const loadStatus = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ refType, refId });
      const res = await fetch(`/api/proxy/v1/estab/files/by-ref?${qs.toString()}`, { signal });
      if (res.status === 404) { setFile(null); return; }
      if (!res.ok) throw new Error(await res.text());
      const body = (await res.json()) as { data?: LinkedFile };
      setFile(body.data ?? null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      // Status is best-effort; a failure here shouldn't block the raise action.
      setFile(null);
    } finally {
      setLoading(false);
    }
  }, [refType, refId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadStatus(controller.signal);
    return () => controller.abort();
  }, [loadStatus]);

  useEffect(() => {
    onLinkedFileChange?.({ loading, file });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- report only when the lookup result changes, not when the parent re-creates the callback.
  }, [loading, file]);

  // Default "Initiating officer" to the signed-in user's own employee record the first time the form
  // opens (GAP-FINANCE-PAYMENTS-DETAIL-02). Best-effort: a user with no employee record or a failed
  // lookup simply gets an empty picker, exactly as before, and can still search for the officer.
  const self = useSelfEmployee(open);
  useEffect(() => {
    if (!self) return;
    setSelfDefaultId(self.id);
    setInitiatedBy((cur) => cur ?? self.id);
    setInitiatedOption((cur) => cur ?? self);
  }, [self]);

  const raisable = !file || (allowRaiseAfterTerminal && !isEofficeFileInFlight(file.status));

  const submit = useCallback(async () => {
    setError("");
    setMessage("");
    setWarning("");
    if (!initiatedBy) { setError("Choose the initiating officer."); return; }
    if (!currentWith) { setError("Choose who to forward to."); return; }
    if (note.trim().length < 3) { setError("Add a note explaining the proposal."); return; }
    setSaving(true);
    try {
      const payload = {
        refType, refId, subject, dept, classification, priority,
        initiatedBy, currentWith,
        approvalChain: defaultApprovalChain,
        initialNote: note.trim(),
        context: amountMinor != null ? { amountMinor } : {},
      };
      const res = await fetch("/api/proxy/v1/estab/files/from-module", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      // Never print the raw response body (JSON / stack text) at an officer.
      if (!res.ok) throw new RaiseFailed(await errorMessageFromResponse(res, "save", "eFile"));
      const body = (await res.json()) as { id?: string; fileNo?: string };
      // Close the loop on the source side: move the originating entity to
      // "pending approval" so its own screen reflects the in-flight decision.
      let notifyFailed = false;
      if (notifyPath) {
        try {
          const nres = await fetch(notifyPath, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: notifyWithFileNo && body.fileNo ? JSON.stringify({ fileNo: body.fileNo }) : "{}",
          });
          notifyFailed = !nres.ok;
        } catch {
          notifyFailed = true;
        }
      }
      // The eOffice file is already raised, so this is a warning (not a
      // failure): the source record's status may not yet reflect the file.
      if (notifyFailed) {
        setWarning("The eFile was raised, but the record could not be marked as awaiting approval. Refresh the page; if its status has not changed, contact the Finance helpdesk.");
      }
      const who = initiatedOption && currentWithOption ? ` Initiated by ${initiatedOption.label}, forwarded to ${currentWithOption.label}.` : "";
      setMessage(`Raised eFile ${body.fileNo ?? ""} for approval. Routing by amount via the approval matrix.${who}`);
      setOpen(false);
      setNote("");
      setTimeout(() => void loadStatus(), 900);
    } catch (err) {
      if (err instanceof RaiseFailed) {
        setError(err.message);
      } else {
        const human = toHumanError("save", { area: "eFile" });
        setError(`${human.what} ${human.next}`);
      }
    } finally {
      setSaving(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- notifyPath is always a pure function of refId/the entity id (see call sites), which is already listed here; it cannot change independently.
  }, [initiatedBy, currentWith, initiatedOption, currentWithOption, note, refType, refId, subject, dept, classification, priority, defaultApprovalChain, amountMinor, loadStatus]);

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-h" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3>eOffice approval</h3>
        {loading ? (
          <span style={{ color: "var(--mut)", fontSize: "0.8125rem" }}>Checking…</span>
        ) : file ? (
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="mono" style={{ fontSize: "0.8125rem" }}>{file.file_no}</span>
            <StatusPill status={file.status} />
            <a className="btn ghost" href={`/estab/files/${file.id}`}>Open file</a>
            {raisable ? (
              <Button variant="primary" onClick={() => setOpen((v) => !v)}>
                {open ? "Cancel" : "Raise for approval"}
              </Button>
            ) : null}
          </span>
        ) : (
          <Button variant="primary" onClick={() => setOpen((v) => !v)}>
            {open ? "Cancel" : "Raise for approval"}
          </Button>
        )}
      </div>

      <div role="status" aria-live="polite">
        {message ? <p className="pad" style={{ color: "#047857", fontSize: "0.8125rem", paddingBottom: 0 }}>{message}</p> : null}
        {error ? <p className="pad" style={{ color: "#b91c1c", fontSize: "0.8125rem", paddingBottom: 0 }}>{error}</p> : null}
      </div>
      {warning ? <p role="alert" className="pad" style={{ color: "#b45309", fontSize: "0.8125rem", paddingBottom: 0 }}>{warning}</p> : null}

      {raisable && open ? (
        <div className="pad" style={{ display: "grid", gap: 12 }}>
          <p style={{ fontSize: "0.8125rem", color: "#64748b", margin: 0 }}>
            Raising sends this {refType.replace(/_/g, " ")} to eOffice for a formal, tamper-proof decision.
            The approval chain is selected automatically by amount.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <Field label="Initiating officer">
              <EmployeePicker
                key={selfDefaultId ?? "none"}
                value={initiatedBy}
                onChange={(id, opt) => { setInitiatedBy(id); setInitiatedOption(opt); }}
                {...(self ? { initialOption: self } : {})}
                placeholder="Search by name or employee number…"
              />
            </Field>
            <Field label="Forward to officer">
              <EmployeePicker
                value={currentWith}
                onChange={(id, opt) => { setCurrentWith(id); setCurrentWithOption(opt); }}
                placeholder="Search by name or employee number…"
              />
            </Field>
          </div>
          <Field label="Classification">
            <Select value={classification} onChange={(e) => setClassification(e.target.value as typeof classification)}>
              {CLASSIFICATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>Proposal note</span>
            <textarea value={note} rows={3} placeholder="Justification / proposal for approval…" onChange={(e) => setNote(e.target.value)} />
          </label>
          <div>
            <Button variant="primary" disabled={saving} onClick={() => void submit()}>
              {saving ? "Raising…" : "Submit to eOffice"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
