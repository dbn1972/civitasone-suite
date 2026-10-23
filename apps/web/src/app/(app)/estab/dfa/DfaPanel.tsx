"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, DataTable, StatusPill, ActionButton, Segmented, ErrorState, EntityPicker, type EntityOption } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { humanizeStatus, formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { SIGN_RECORDS_COPY } from "../_shared/signatureCopy";

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
  /** Linked file number (GAP-ESTAB-DFA-04). */
  fileNo?: string | null;
  createdAt?: string;
  updatedAt: string;
  returnedReason?: string | null;
  /** Drafter id (GAP-ESTAB-DFA-02): the maker cannot approve or sign. */
  createdBy?: string;
  /** Drafter's name resolved by the service (GAP-ESTAB-DFA-04); null/absent = unresolvable. */
  createdByName?: string | null;
};

const COMM_TYPES = ["letter", "order", "memo", "notification", "circular", "do_letter"] as const;

// GAP-ESTAB-DFA-03: add "returned" filter so returned drafts are reachable.
const FILTERS = ["all", "draft", "pending_approval", "returned", "approved", "signed", "dispatched"] as const;
type Filter = (typeof FILTERS)[number];

const EMPTY = { communicationType: "letter", subject: "", body: "", recipientName: "", recipientAddress: "", fileId: "" };

// GAP-ESTAB-DFA-06: the write is eventually consistent (CQRS: the POST is accepted, a consumer
// applies it), so after it the list is polled a bounded number of times, then the officer is told.
const POLL_INTERVAL_MS = 1000;
const POLL_MAX_TRIES = 5;

function listQuery(view: Filter): string {
  return view === "all" ? "?limit=100" : `?status=${view}&limit=100`;
}

/**
 * Has the action on `id` taken effect, as seen in the list for `view`? In the "all" view (or the
 * tab of the status the action produces) the row must be present with the new status. In any
 * other status tab the row LEAVES the tab when its status changes (an approved draft is no
 * longer under "Pending Approval"), so its absence is the effect. In "all" an absent row is
 * not proof (it may sit past the list limit), so the poll keeps waiting.
 */
function confirmsTransition(fresh: Dfa[], id: string, expected: string, view: Filter): boolean {
  const row = fresh.find((d) => d.id === id);
  if (row) return row.status === expected;
  return view !== "all" && view !== expected;
}

// GAP-ESTAB-DFA-04: the existing estab file search, as an EntityPicker adapter (file no + subject).
async function searchFiles(query: string, signal: AbortSignal): Promise<EntityOption[]> {
  const res = await fetch(`/api/proxy/v1/estab/files/search?q=${encodeURIComponent(query)}&limit=10`, { signal });
  // Throw so EntityPicker shows its search-error text; [] would read as "No matches".
  if (!res.ok) throw new Error("file search failed");
  const body = (await res.json()) as { data?: Array<{ id: string; fileNo: string; subject: string }> };
  return (body.data ?? []).map((f) => ({ id: f.id, label: f.fileNo, sublabel: f.subject }));
}

type DfaAction = "submit" | "approve" | "return" | "sign" | "dispatch";

// GAP-ESTAB-DFA-05: human-readable action → done message map.
const ACTION_DONE: Record<DfaAction, string> = {
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
const ACTION_STEP_STATUS: Record<DfaAction, string> = {
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

export function DfaPanel({
  viewerId = null,
  canApprove = false,
  canDraft = false,
}: {
  /** Session user id (JWT sub); null when unknown. */
  viewerId?: string | null;
  /** Viewer holds an approver role (approve / return / sign). */
  canApprove?: boolean;
  /** Viewer holds a drafter role (submit / dispatch). */
  canDraft?: boolean;
}) {
  const [rows, setRows] = useState<Dfa[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
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
  // GAP-ESTAB-DFA-06: one poll at a time. The timer, the in-flight fetch's AbortController and a
  // generation counter belong to the latest poll; stopPolling() invalidates all three, so a
  // superseded or unmounted poll can neither re-arm a timer nor touch state.
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const pollGenRef = useRef(0);
  const mountedRef = useRef(true);
  const filterRef = useRef<Filter>("all");
  const [refreshing, setRefreshing] = useState(false);

  // GAP2-ESTAB-NOTIFICATIONS-DFALINK-01: the eOffice notifications feed deep-
  // links DFA items to /estab/dfa?focus=<id> (there is no /estab/dfa/[id]
  // detail route). Honour that param: surface which draft the officer followed
  // in and highlight its row when it is present in the current view.
  const searchParams = useSearchParams();
  const tFocus = useTranslations("estabDfaFocus");
  const tP2 = useTranslations("estabP2");
  const tFallback = useTranslations("employeeFallback");
  const focusId = searchParams?.get("focus") ?? "";
  const focusedRow = focusId ? rows.find((d) => d.id === focusId) : undefined;

  const stopPolling = useCallback(() => {
    pollGenRef.current += 1;
    if (pollTimerRef.current !== null) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null; }
    if (pollAbortRef.current) { pollAbortRef.current.abort(); pollAbortRef.current = null; }
  }, []);

  // Unmount: cancel the pending timer and the in-flight poll fetch.
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; stopPolling(); };
  }, [stopPolling]);

  // A poll belongs to the view that started it; switching tab ends it.
  useEffect(() => {
    filterRef.current = filter;
    stopPolling();
    setRefreshing(false);
  }, [filter, stopPolling]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    // GAP-ESTAB-DFA-01: clear rows on load start to prevent stale-filter data.
    setRows([]);
    setLoadFailed(false);
    try {
      const res = await fetch(`/api/proxy/v1/estab/dfa${listQuery(filter)}`, { signal });
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
      // An aborted load was superseded by a newer one; it must not flip loading off under it.
      if (!signal?.aborted) setLoading(false);
    }
  }, [filter, fromResponse, fromException]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // GAP-ESTAB-DFA-06: bounded poll instead of a fixed timeout. Fetches the list for `view` every
  // POLL_INTERVAL_MS, up to POLL_MAX_TRIES times, until `confirmed(fresh)`; then shows the fresh
  // rows. A newer poll supersedes this one, and unmount or a tab change ends it (no state update,
  // no new timer, the in-flight fetch is aborted).
  const pollUntil = useCallback(
    (confirmed: (fresh: Dfa[]) => boolean, view: Filter) => {
      // The officer may have switched tab while the POST was in flight: the poll would then
      // overwrite the new tab's rows with the old tab's list.
      if (view !== filterRef.current) return;
      stopPolling();
      const gen = pollGenRef.current;
      const controller = new AbortController();
      pollAbortRef.current = controller;
      const live = () => gen === pollGenRef.current && mountedRef.current;
      setRefreshing(true);
      const attempt = (remaining: number) => {
        pollTimerRef.current = setTimeout(async () => {
          pollTimerRef.current = null;
          let done = false;
          try {
            const res = await fetch(`/api/proxy/v1/estab/dfa${listQuery(view)}`, { signal: controller.signal });
            if (!live()) return;
            if (res.ok) {
              const body = (await res.json()) as { data?: Dfa[] };
              if (!live()) return;
              const fresh = body.data ?? [];
              if (confirmed(fresh)) { setRows(fresh); done = true; }
            }
          } catch {
            if (!live()) return; // aborted or unmounted: stop quietly
            // otherwise a transient failure: fall through and try again
          }
          if (!live()) return;
          if (done || remaining <= 1) {
            pollAbortRef.current = null;
            setRefreshing(false);
            if (!done) {
              const hint = tP2("dfaStillProcessing");
              setMessage((m) => (m ? `${m} ${hint}` : hint));
            }
            return;
          }
          attempt(remaining - 1);
        }, POLL_INTERVAL_MS);
      };
      attempt(POLL_MAX_TRIES);
    },
    [stopPolling, tP2],
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
        ...(form.fileId ? { fileId: form.fileId } : {}),
      };
      const res = await fetch("/api/proxy/v1/estab/dfa", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError((await fromResponse(res, "save")).message);
        return;
      }
      // The 202 acknowledgement carries the new draft's id (sendAccepted).
      const accepted = (await res.json().catch(() => null)) as { id?: unknown } | null;
      const newId = typeof accepted?.id === "string" ? accepted.id : null;
      if (!mountedRef.current) return;
      setMessage("Draft created. Submit it for approval when ready.");
      setCurrentStepTitle(stepTitleFor("draft"));
      setForm({ ...EMPTY }); setShowForm(false);
      // GAP-ESTAB-DFA-06: a new draft belongs in the All and Draft views only; poll there until it
      // is listed. In any other tab it would never appear, so waiting on it would be pointless.
      if (filter === "all" || filter === "draft") {
        const known = new Set(rows.map((d) => d.id));
        pollUntil((fresh) => (newId ? fresh.some((d) => d.id === newId) : fresh.some((d) => !known.has(d.id))), filter);
      }
    } catch (err) {
      setError(fromException("save", err).message);
    } finally {
      setSaving(false);
    }
  }, [form, rows, filter, pollUntil, fromResponse, fromException, clear]);

  const act = useCallback(async (id: string, action: DfaAction, reason?: string) => {
    const res = await fetch(`/api/proxy/v1/estab/dfa/${id}/${action}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: reason ? JSON.stringify({ reason }) : JSON.stringify({}),
    });
    if (!res.ok) {
      const resolved = await fromResponse(res, "save");
      throw UserFacingError.from(resolved);
    }
    if (!mountedRef.current) return;
    // GAP-ESTAB-DFA-05: clerk-friendly success message.
    setMessage(ACTION_DONE[action]);
    // Req 2.6: announce the step
    const expected = ACTION_STEP_STATUS[action];
    setCurrentStepTitle(stepTitleFor(expected));
    // GAP-ESTAB-DFA-06: poll until the status change is visible in the current view.
    pollUntil((fresh) => confirmsTransition(fresh, id, expected, filter), filter);
  }, [filter, pollUntil, fromResponse]);

  // GAP-ESTAB-DFA-02: Approve now has requireReason. Actions still server-enforced
  // (APPROVER_ROLES, maker≠checker in consumer). The Sign dialog states what signing records via the shared SIGN_RECORDS_COPY.
  const actionsFor = (d: Dfa) => {
    // GAP-ESTAB-DFA-02: segregation of duties. The drafter may not approve or
    // sign their own DFA (server: 403 MAKER_CHECKER_VIOLATION); a viewer
    // without the role sees no control at all, never a button that will 403.
    const isDrafter = viewerId !== null && d.createdBy !== undefined && d.createdBy === viewerId;
    const note = (text: string) => <span style={{ color: "var(--mut)", fontSize: "0.8125rem" }}>{text}</span>;
    switch (d.status) {
      case "draft":
      case "returned":
        if (!canDraft) return <span style={{ color: "var(--mut)" }}>—</span>;
        return (
          <ActionButton label="Submit" className="btn primary"
            confirmTitle="Submit this draft for approval?"
            confirmDescription="The draft will be locked from editing while it is under approval."
            confirmLabel="Submit" onConfirm={() => act(d.id, "submit")} />
        );
      case "pending_approval":
        if (!canApprove) return note("Awaiting approver");
        if (isDrafter) return note("You drafted this; another approver must act.");
        return (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {/* GAP-ESTAB-DFA-02: requireReason on Approve so approvals are auditable.
                GAP-ESTAB-DFA-04: show the full body + recipient so the approver
                reads the content, not just the subject line. */}
            <ActionButton label="Approve" className="btn primary"
              confirmTitle="Approve this draft?"
              confirmDescription={<DraftPreview d={d} />}
              confirmLabel="Approve"
              requireReason reasonLabel="Approval remarks" maxReasonLength={1000}
              onConfirm={(r) => act(d.id, "approve", r)} />
            <ActionButton label="Return" className="btn ghost" danger requireReason reasonLabel="Reason for return"
              minReasonLength={3} maxReasonLength={1000}
              confirmTitle="Return this draft?" confirmDescription={<DraftPreview d={d} />}
              confirmLabel="Return" onConfirm={(r) => act(d.id, "return", r)} />
          </div>
        );
      case "approved":
        if (!canApprove) return note("Awaiting signature");
        if (isDrafter) return note("You drafted this; another officer must sign.");
        return (
          <ActionButton label="Sign" className="btn primary"
            confirmTitle="Record signing of this DFA?"
            confirmDescription={<><DraftPreview d={d} /><p style={{ marginTop: 8 }}>{SIGN_RECORDS_COPY}</p></>}
            confirmLabel="Sign" onConfirm={() => act(d.id, "sign")} />
        );
      case "signed":
        if (!canDraft) return <span style={{ color: "var(--mut)" }}>—</span>;
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
        {/* GAP-ESTAB-DFA-06: shown while the list is being re-read after a create or an action */}
        {refreshing ? <p style={{ color: "var(--mut)", fontSize: "0.875rem" }}>{tP2("dfaRefreshing")}</p> : null}
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
              ? tFocus("shown", { dfaNo: focusedRow.dfaNo, subject: focusedRow.subject })
              : tFocus("missing")}
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
            <div style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
              <span id="dfa-file-label">{tP2("dfaLinkFileLabel")}</span>
              <EntityPicker
                value={form.fileId || null}
                onChange={(v) => setForm((f) => ({ ...f, fileId: typeof v === "string" ? v : "" }))}
                search={searchFiles}
                placeholder={tP2("dfaLinkFilePlaceholder")}
                aria-label={tP2("dfaLinkFileLabel")}
              />
            </div>
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
              // GAP-ESTAB-DFA-04: who drafted it (a name, never the id) and the linked eOffice file.
              { key: "createdByName", label: tP2("dfaDraftedBy"), render: (d) => <>{d.createdByName || tFallback("unknownEmployee")}</> },
              { key: "fileId", label: tP2("dfaFile"), sortable: false, render: (d) => (
                d.fileId ? <Link href={`/estab/files/${d.fileId}`}>{d.fileNo || tP2("dfaOpenFile")}</Link> : <>—</>
              ) },
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
    <div style={{ fontSize: 13, maxHeight: 320, overflow: "auto" }}>
      <p><strong>{d.dfaNo}</strong> — {d.subject}</p>
      {d.recipientName && <p style={{ color: "var(--mut)" }}>To: {d.recipientName}</p>}
      {d.body ? (
        <div style={{ whiteSpace: "pre-wrap", marginTop: 4, padding: 8, background: "var(--bg2)", borderRadius: 8 }}>
          {/* GAP-ESTAB-DFA-04: the FULL body, so the approver reads everything before Approve. */}
          {d.body}
        </div>
      ) : (
        <p style={{ color: "var(--mut)" }}>Draft body not available in this view.</p>
      )}
    </div>
  );
}
