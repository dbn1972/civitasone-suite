"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, DataTable, StatusPill, ActionButton, Segmented, ErrorState } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { humanizeStatus, formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

// GAP-ESTAB-DFA-04: extended Dfa type to include fields the API already returns.
type Dfa = {
  id: string;
  dfaNo: string;
  communicationType: string;
  subject: string;
  body?: string;
  status: string;
  editable: boolean;
  recipientName: string | null;
  fileId: string | null;
  createdAt?: string;
  updatedAt: string;
  returnedReason?: string | null;
};

const COMM_TYPES = ["letter", "order", "memo", "notification", "circular", "do_letter"] as const;

// GAP-ESTAB-DFA-03: add "returned" filter so returned drafts are reachable.
const FILTERS = ["all", "draft", "pending_approval", "returned", "approved", "signed", "dispatched"] as const;

const EMPTY = { communicationType: "letter", subject: "", body: "", recipientName: "", recipientAddress: "" };

// GAP-ESTAB-DFA-05: human-readable action → done message map.
const ACTION_DONE: Record<string, string> = {
  submit: "Draft submitted for approval.",
  approve: "Draft approved.",
  return: "Draft returned for revision.",
  sign: "Draft signed.",
  dispatch: "Draft dispatched.",
};

// GAP-ESTAB-DFA-05: human labels for filter tabs.
const FILTER_LABEL: Record<string, string> = {
  all: "All",
  draft: "Draft",
  pending_approval: "Pending Approval",
  returned: "Returned",
  approved: "Approved",
  signed: "Signed",
  dispatched: "Dispatched",
};

// Req 2.6: title for the lifecycle step produced by an action.
const ACTION_STEP_STATUS: Record<string, string> = {
  submit: "pending_approval",
  approve: "approved",
  return: "returned",
  sign: "signed",
  dispatch: "dispatched",
};
function stepTitleFor(status: string): string {
  const label = status.replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function DfaPanel() {
  const [rows, setRows] = useState<Dfa[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [loading, setLoading] = useState(true);
  // GAP-ESTAB-DFA-01: separate load-error from action-error.
  const [loadFailed, setLoadFailed] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const { fromResponse, fromException, clear } = useFormError("DFA");
  // Req 2.6: announce the new lifecycle step via an assertive live region.
  const [currentStepTitle, setCurrentStepTitle] = useState("");
  // GAP-ESTAB-DFA-06: timers for cleanup.
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // GAP2-ESTAB-NOTIFICATIONS-DFALINK-01: the eOffice notifications feed deep-
  // links DFA items to /estab/dfa?focus=<id> (there is no /estab/dfa/[id]
  // detail route). Honour that param: surface which draft the officer followed
  // in and highlight its row when it is present in the current view.
  const searchParams = useSearchParams();
  const focusId = searchParams?.get("focus") ?? "";
  const focusedRow = focusId ? rows.find((d) => d.id === focusId) : undefined;

  // Cleanup pending polls on unmount.
  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    // GAP-ESTAB-DFA-01: clear rows on load start to prevent stale-filter data.
    setRows([]);
    setLoadFailed(false);
    try {
      const qs = filter === "all" ? "?limit=100" : `?status=${filter}&limit=100`;
      const res = await fetch(`/api/proxy/v1/estab/dfa${qs}`, { signal });
      if (!res.ok) {
        setLoadFailed(true);
        setError((await fromResponse(res, "load")).message);
        return;
      }
      const body = (await res.json()) as { data?: Dfa[] };
      setRows(body.data ?? []);
      setError("");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setLoadFailed(true);
      setError(fromException("load", err).message);
    } finally {
      setLoading(false);
    }
  }, [filter, fromResponse, fromException]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // GAP-ESTAB-DFA-06: bounded poll instead of fixed 800ms timeout.
  const pollUntil = useCallback(
    (predicate: (rows: Dfa[]) => boolean, remaining = 5) => {
      if (remaining <= 0) {
        setMessage((m) => (m ? `${m} — still processing, refresh later.` : ""));
        return;
      }
      pollRef.current = setTimeout(async () => {
        try {
          const qs = filter === "all" ? "?limit=100" : `?status=${filter}&limit=100`;
          const res = await fetch(`/api/proxy/v1/estab/dfa${qs}`);
          if (!res.ok) return;
          const body = (await res.json()) as { data?: Dfa[] };
          const fresh = body.data ?? [];
          if (predicate(fresh)) {
            setRows(fresh);
          } else {
            pollUntil(predicate, remaining - 1);
          }
        } catch { /* ignore — will retry or give up */ }
      }, 1000);
    },
    [filter],
  );

  const create = useCallback(async () => {
    setSaving(true); setMessage(""); setError("");
    clear();
    try {
      if (form.subject.trim().length < 3) throw new UserFacingError("Subject is required");
      if (form.body.trim().length < 1) throw new UserFacingError("Draft body is required");
      const payload = {
        communicationType: form.communicationType,
        subject: form.subject.trim(),
        body: form.body.trim(),
        ...(form.recipientName.trim() ? { recipientName: form.recipientName.trim() } : {}),
        ...(form.recipientAddress.trim() ? { recipientAddress: form.recipientAddress.trim() } : {}),
      };
      const res = await fetch("/api/proxy/v1/estab/dfa", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError((await fromResponse(res, "save")).message);
        return;
      }
      setMessage("Draft created. Submit it for approval when ready.");
      setCurrentStepTitle(stepTitleFor("draft"));
      setForm({ ...EMPTY }); setShowForm(false);
      // GAP-ESTAB-DFA-06: poll for the new draft to appear.
      pollUntil((fresh) => fresh.length > rows.length);
    } catch (err) {
      setError(fromException("save", err).message);
    } finally {
      setSaving(false);
    }
  }, [form, rows.length, pollUntil, fromResponse, fromException, clear]);

  const act = useCallback(async (id: string, action: string, reason?: string) => {
    const res = await fetch(`/api/proxy/v1/estab/dfa/${id}/${action}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: reason ? JSON.stringify({ reason }) : JSON.stringify({}),
    });
    if (!res.ok) {
      const resolved = await fromResponse(res, "save");
      throw UserFacingError.from(resolved);
    }
    // GAP-ESTAB-DFA-05: clerk-friendly success message.
    setMessage(ACTION_DONE[action] ?? `DFA ${humanizeStatus(action)} done.`);
    // Req 2.6: announce the step
    const nextStatus = ACTION_STEP_STATUS[action];
    if (nextStatus) setCurrentStepTitle(stepTitleFor(nextStatus));
    // GAP-ESTAB-DFA-06: poll for the status change.
    const expected = ACTION_STEP_STATUS[action];
    if (expected) {
      pollUntil((fresh) => {
        const row = fresh.find((d) => d.id === id);
        return row?.status === expected;
      });
    } else {
      void load();
    }
  }, [load, pollUntil, fromResponse]);

  // GAP-ESTAB-DFA-02: Approve now has requireReason. Actions still server-enforced
  // (APPROVER_ROLES, maker≠checker in consumer). Sign description is Phase 2 honest.
  const actionsFor = (d: Dfa) => {
    switch (d.status) {
      case "draft":
      case "returned":
        return (
          <ActionButton label="Submit" className="btn primary"
            confirmTitle="Submit this draft for approval?"
            confirmDescription="The draft will be locked from editing while it is under approval."
            confirmLabel="Submit" onConfirm={() => act(d.id, "submit")} />
        );
      case "pending_approval":
        return (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {/* GAP-ESTAB-DFA-02: requireReason on Approve so approvals are auditable.
                GAP-ESTAB-DFA-04: show the full body + recipient so the approver
                reads the content, not just the subject line. */}
            <ActionButton label="Approve" className="btn primary"
              confirmTitle="Approve this draft?"
              confirmDescription={<DraftPreview d={d} />}
              confirmLabel="Approve"
              requireReason reasonLabel="Approval remarks"
              onConfirm={(r) => act(d.id, "approve", r)} />
            <ActionButton label="Return" className="btn ghost" danger requireReason reasonLabel="Reason for return"
              confirmTitle="Return this draft?" confirmDescription={<DraftPreview d={d} />}
              confirmLabel="Return" onConfirm={(r) => act(d.id, "return", r)} />
          </div>
        );
      case "approved":
        return (
          <ActionButton label="Sign" className="btn primary"
            confirmTitle="Record signing of this DFA?"
            confirmDescription={<><DraftPreview d={d} /><p style={{ marginTop: 8 }}>Records who signed and when. Cryptographic e-Sign/DSC arrives in Phase 2.</p></>}
            confirmLabel="Sign" onConfirm={() => act(d.id, "sign")} />
        );
      case "signed":
        return (
          <ActionButton label="Dispatch" className="btn primary"
            confirmTitle="Dispatch this communication?"
            confirmDescription="A dispatch record will be created and the DFA closed."
            confirmLabel="Dispatch" onConfirm={() => act(d.id, "dispatch")} />
        );
      default:
        return <span style={{ color: "var(--mut)" }}>—</span>;
    }
  };

  return (
    <div style={{ display: "grid", gap: 18, marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        {/* GAP-ESTAB-DFA-03 + DFA-05: human-labelled tabs including "Returned". */}
        <Segmented
          options={FILTERS.map((f) => FILTER_LABEL[f] ?? humanizeStatus(f))}
          value={FILTER_LABEL[filter] ?? humanizeStatus(filter)}
          onChange={(v) => {
            const key = FILTERS.find((f) => (FILTER_LABEL[f] ?? humanizeStatus(f)) === v);
            if (key) setFilter(key);
          }}
        />
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "+ New draft"}</Button>
      </div>

      <div role="status" aria-live="polite">
        {message ? <p style={{ color: "var(--good)", fontSize: "0.875rem" }}>{message}</p> : null}
        {/* GAP-ESTAB-DFA-01: load error shows ErrorState, not just text */}
        {error && !loadFailed ? <p style={{ color: "var(--bad)", fontSize: "0.875rem" }}>{error}</p> : null}
      </div>

      <span className="sr-only" aria-live="assertive" aria-atomic="true">{currentStepTitle}</span>

      {/* GAP2-ESTAB-NOTIFICATIONS-DFALINK-01: show the officer which draft they
          followed in from a notification, and whether it is in the current
          filter view. */}
      {focusId ? (
        <div className="card" data-testid="dfa-focus-banner">
          <p className="pad" style={{ fontSize: "0.875rem", color: "var(--ink2)" }}>
            {focusedRow
              ? `Showing the draft you selected: ${focusedRow.dfaNo} — ${focusedRow.subject}.`
              : "The draft you selected isn't in this view — switch to \u201CAll\u201D or another status to find it."}
          </p>
        </div>
      ) : null}

      {showForm ? (
        <div className="card">
          <div className="card-h"><h3>New draft</h3></div>
          <div className="pad" style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
                <span>Type</span>
                <select value={form.communicationType} onChange={(e) => setForm((f) => ({ ...f, communicationType: e.target.value }))}>
                  {COMM_TYPES.map((t) => <option key={t} value={t}>{humanizeStatus(t)}</option>)}
                </select>
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
                <span>Recipient name (external)</span>
                <input value={form.recipientName} onChange={(e) => setForm((f) => ({ ...f, recipientName: e.target.value }))} />
              </label>
            </div>
            <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
              <span>Subject</span>
              <input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
              <span>Recipient address (external, optional)</span>
              <input value={form.recipientAddress} onChange={(e) => setForm((f) => ({ ...f, recipientAddress: e.target.value }))} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
              <span>Draft body</span>
              <textarea rows={6} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
            </label>
            <div>
              <Button disabled={saving || !form.subject || !form.body} onClick={() => void create()}>
                {saving ? "Creating…" : "Create draft"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="card">
        {loading ? (
          <p className="pad" style={{ textAlign: "center", color: "var(--mut)" }}>Loading…</p>
        ) : loadFailed ? (
          // GAP-ESTAB-DFA-01: retryable error state, not "No drafts" + red text.
          <div className="pad">
            <ErrorState error={toHumanError("load", { area: "drafts" })} onRetry={() => void load()} />
          </div>
        ) : rows.length === 0 ? (
          <p className="pad" style={{ color: "var(--mut)" }}>No drafts in this view.</p>
        ) : (
          <DataTable<Dfa>
            columns={[
              { key: "dfaNo", label: "DFA No", render: (d) => (
                <span
                  className="mono"
                  data-focused={d.id === focusId ? "true" : undefined}
                  style={d.id === focusId ? { fontWeight: 700, color: "var(--info)" } : undefined}
                >
                  {d.dfaNo}
                  {d.id === focusId ? <span className="sr-only"> (selected)</span> : null}
                </span>
              ) },
              { key: "communicationType", label: "Type", render: (d) => <>{humanizeStatus(d.communicationType)}</> },
              { key: "subject", label: "Subject" },
              { key: "recipientName", label: "Recipient", render: (d) => <>{d.recipientName ?? "—"}</> },
              // GAP-ESTAB-DFA-04: show updatedAt.
              { key: "updatedAt", label: "Updated", render: (d) => <>{formatIndianDate(d.updatedAt)}</> },
              { key: "status", label: "Status", render: (d) => <StatusPill status={d.status} /> },
              { key: "id", label: "Action", sortable: false, render: (d) => actionsFor(d) },
            ]}
            rows={rows}
          />
        )}
      </div>
    </div>
  );
}

/** GAP-ESTAB-DFA-04: preview the DFA content inside Approve/Sign dialogs
 *  so the approver reads the body — not just the subject line. */
function DraftPreview({ d }: { d: Dfa }) {
  return (
    <div style={{ fontSize: 13, maxHeight: 200, overflow: "auto" }}>
      <p><strong>{d.dfaNo}</strong> — {d.subject}</p>
      {d.recipientName && <p style={{ color: "var(--mut)" }}>To: {d.recipientName}</p>}
      {d.body ? (
        <div style={{ whiteSpace: "pre-wrap", marginTop: 4, padding: 8, background: "var(--bg2)", borderRadius: 8 }}>
          {d.body.length > 500 ? `${d.body.slice(0, 500)}…` : d.body}
        </div>
      ) : (
        <p style={{ color: "var(--mut)" }}>Draft body not available in this view.</p>
      )}
    </div>
  );
}
