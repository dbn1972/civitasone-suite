"use client";

import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { useCallback, useEffect, useState } from "react";
import { Button, DataTable, StatusPill, ConfirmDialog, useConfirmAction, ErrorState } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { useTranslations } from "next-intl";
import { loadMaps, resolveLabel, type OfficerMaps } from "../files/[id]/OfficerName";

type Operator = { id: string; employeeId: string; division: string; deskRole: string; active: boolean };
type Handover = {
  id: string;
  fromOfficerId: string;
  toOfficerId: string;
  reason: string;
  remarks: string | null;
  fileCount: number;
  status: string;
  createdAt: string;
};

const REASONS = ["transfer", "leave", "retirement", "suspension"] as const;
const REASON_LABEL: Record<string, string> = {
  transfer: "Transfer",
  leave: "Leave",
  retirement: "Retirement",
  suspension: "Suspension",
};
const reasonLabel = (r: string) => REASON_LABEL[r] ?? r;
const EMPTY = { fromOfficerId: "", toOfficerId: "", reason: "transfer", remarks: "" };

type CountState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "ok"; movable: number; staysBehind: number };

export function HandoverPanel() {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [rows, setRows] = useState<Handover[]>([]);
  const [loading, setLoading] = useState(true);
  // True once the FIRST load has settled. Until then the officer pickers would
  // render with empty rosters (a selection made in that window silently snaps
  // back to "Select…"), so the form shows a loading placeholder instead.
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // GAP-ESTAB-HANDOVER-05: the two loads fail independently. An operators-roster
  // failure blocks the form (you can't pick officers from an empty roster); a
  // history-only failure leaves the form fully usable and shows its error in the
  // history card.
  const [operatorsFailed, setOperatorsFailed] = useState(false);
  const [historyFailed, setHistoryFailed] = useState(false);
  // GAP-ESTAB-HANDOVER-01: resolved officer name maps for readable labels.
  const [officerMaps, setOfficerMaps] = useState<OfficerMaps | null>(null);
  const tFallback = useTranslations("employeeFallback");
  const t = useTranslations("estabW2");
  // GAP-ESTAB-HANDOVER-03: how many files a handover will move off the selected
  // from-officer's desk. `staysBehind` is the live files the handover does NOT move
  // (drafts, closed), so the preview never overstates. A handover cannot start
  // until this is known and non-zero.
  const [count, setCount] = useState<CountState>({ kind: "idle" });
  const [countNonce, setCountNonce] = useState(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setOperatorsFailed(false);
    setHistoryFailed(false);
    try {
      // Settled, not Promise.all: a failure of one list must not discard the other.
      const [opRes, hoRes] = await Promise.allSettled([
        fetch("/api/proxy/v1/estab/operators?activeOnly=false&limit=500", { signal }),
        fetch("/api/proxy/v1/estab/handovers?limit=100", { signal }),
      ]);
      // An abort means the panel unmounted while the requests were in flight.
      const aborted = (r: PromiseSettledResult<Response>) =>
        r.status === "rejected" && r.reason instanceof Error && r.reason.name === "AbortError";
      if (aborted(opRes) || aborted(hoRes)) return;

      // A non-OK status is a real failure - never swallow it into an empty list,
      // which would falsely read as "no handovers recorded".
      let rosterLoaded = false;
      if (opRes.status === "fulfilled" && opRes.value.ok) {
        try {
          setOperators(((await opRes.value.json()) as { data?: Operator[] }).data ?? []);
          rosterLoaded = true;
        } catch {
          setOperatorsFailed(true);
        }
      } else {
        setOperatorsFailed(true);
      }
      if (hoRes.status === "fulfilled" && hoRes.value.ok) {
        try {
          setRows(((await hoRes.value.json()) as { data?: Handover[] }).data ?? []);
        } catch {
          setHistoryFailed(true);
        }
      } else {
        setHistoryFailed(true);
      }
      // GAP-ESTAB-HANDOVER-01: best-effort name resolution (shared with OfficerName).
      if (rosterLoaded) {
        try { setOfficerMaps(await loadMaps()); } catch { /* degrade to short id */ }
      }
    } finally {
      setLoading(false);
      setLoadedOnce(true);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // GAP-ESTAB-HANDOVER-03: preview how many files the handover will move off the
  // outgoing officer's desk so the confirm dialog can state the blast radius.
  // Server-side count (never a capped client list); `movableCount` is the exact
  // set the handover consumer reassigns. Re-fetches when the from-officer changes
  // (or on "Check again").
  useEffect(() => {
    const from = form.fromOfficerId;
    if (!from) { setCount({ kind: "idle" }); return; }
    const controller = new AbortController();
    setCount({ kind: "loading" });
    (async () => {
      try {
        const res = await fetch(
          `/api/proxy/v1/estab/files/held-count?officerId=${encodeURIComponent(from)}`,
          { signal: controller.signal },
        );
        if (!res.ok) { setCount({ kind: "failed" }); return; }
        const body = (await res.json()) as { count?: number; movableCount?: number };
        // Without the movable figure there is no number to vouch for: fail closed rather than quote the live count.
        if (typeof body.movableCount !== "number") { setCount({ kind: "failed" }); return; }
        const live = typeof body.count === "number" ? body.count : body.movableCount;
        setCount({ kind: "ok", movable: body.movableCount, staysBehind: Math.max(0, live - body.movableCount) });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setCount({ kind: "failed" });
      }
    })();
    return () => controller.abort();
  }, [form.fromOfficerId, countNonce]);

  // GAP-ESTAB-HANDOVER-01: resolve to "Name · Desk Role (division)" when the
  // HRMS/operator maps are available; degrade to the short id otherwise. The
  // inactive marker (GAP-ESTAB-HANDOVER-04) is preserved in history/dialog text.
  const label = useCallback((empId: string) => {
    if (!empId) return "—";
    const o = operators.find((x) => x.employeeId === empId);
    const inactive = o && !o.active ? " (inactive)" : "";
    const resolved = resolveLabel(empId, officerMaps, tFallback("unknownEmployee"));
    // resolveLabel already appends the desk role when known; add the division
    // and the inactive marker for the handover audit trail.
    if (o) return `${resolved} · ${o.division}${inactive}`;
    return `${resolved}${inactive}`;
  }, [operators, officerMaps, tFallback]);

  // The actual reassignment — moves every file on the outgoing officer's desk.
  // Irreversible, so it runs only after the ConfirmDialog (handoverConfirm).
  const submitAction = useCallback(async () => {
    setSaving(true); setMessage(""); setError("");
    try {
      const res = await fetch("/api/proxy/v1/estab/handovers", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromOfficerId: form.fromOfficerId, toOfficerId: form.toOfficerId,
          reason: form.reason, ...(form.remarks.trim() ? { remarks: form.remarks.trim() } : {}),
        }),
      });
      if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
      setMessage("Charge handover queued — files are being reassigned.");
      setForm({ ...EMPTY });
      await load();
    } catch (err) {
      // Re-throw so the ConfirmDialog surfaces the error and stays open.
      setSaving(false);
      throw err instanceof Error ? err : new Error("Handover failed");
    } finally {
      setSaving(false);
    }
  }, [form, load]);

  const handoverConfirm = useConfirmAction({ onConfirm: () => submitAction() });

  // Validate before opening the confirm dialog.
  const onHandoverClick = useCallback(() => {
    setMessage(""); setError("");
    if (!form.fromOfficerId || !form.toOfficerId) { setError("Select both officers"); return; }
    if (form.fromOfficerId === form.toOfficerId) { setError("Officers must differ"); return; }
    // The confirm dialog states how many files move, so it never opens without that number.
    if (count.kind !== "ok" || count.movable === 0) return;
    handoverConfirm.trigger();
  }, [form, handoverConfirm, count]);

  const activeOps = operators.filter((o) => o.active);

  return (
    <div style={{ display: "grid", gap: 18, marginTop: 18 }}>
      <div role="status" aria-live="polite">
        {message ? <p style={{ color: "var(--good)", fontSize: "0.875rem" }}>{message}</p> : null}
      </div>
      {error ? (
        <div role="alert" aria-live="assertive">
          <p style={{ color: "var(--bad)", fontSize: "0.875rem" }}>{error}</p>
        </div>
      ) : null}

      <div className="card">
        <div className="card-h"><h3>New charge handover</h3></div>
        {operatorsFailed ? (
          <div className="pad">
            <ErrorState
              error={toHumanError("load", { area: "operator roster" })}
              onRetry={() => void load()}
            />
          </div>
        ) : !loadedOnce ? (
          <p className="pad" style={{ textAlign: "center", color: "var(--mut)" }}>Loading…</p>
        ) : (
          <>
            <div className="pad" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>From officer (outgoing)</span>
            <select value={form.fromOfficerId} onChange={(e) => setForm((f) => ({ ...f, fromOfficerId: e.target.value }))}>
              <option value="">Select…</option>
              {[...operators].sort((a, b) => Number(b.active) - Number(a.active)).map((o) => (
                <option key={o.id} value={o.employeeId}>
                  {label(o.employeeId)}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>To officer (must be active operator)</span>
            <select value={form.toOfficerId} onChange={(e) => setForm((f) => ({ ...f, toOfficerId: e.target.value }))}>
              <option value="">Select…</option>
              {activeOps.map((o) => <option key={o.id} value={o.employeeId}>{label(o.employeeId)}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>Reason</span>
            <select value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}>
              {REASONS.map((r) => <option key={r} value={r}>{reasonLabel(r)}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>Remarks (optional)</span>
            <input value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
          </label>
        </div>
        <div className="pad" style={{ paddingTop: 0 }}>
          {form.fromOfficerId && count.kind === "loading" ? (
            <p role="status" style={{ fontSize: 12, color: "var(--mut)", margin: "0 0 8px" }}>{t("hoCountLoading")}</p>
          ) : null}
          {form.fromOfficerId && count.kind === "failed" ? (
            <div role="alert" style={{ fontSize: 12, color: "var(--bad)", margin: "0 0 8px" }}>
              <span>{t("hoCountFailed")}</span>{" "}
              <Button type="button" variant="ghost" onClick={() => setCountNonce((n) => n + 1)}>{t("hoCountRetry")}</Button>
            </div>
          ) : null}
          {form.fromOfficerId && count.kind === "ok" && count.movable === 0 ? (
            <p role="status" style={{ fontSize: 12, color: "var(--mut)", margin: "0 0 8px" }}>{t("hoNoActiveFiles")}</p>
          ) : null}
          {form.fromOfficerId && count.kind === "ok" && count.movable > 0 ? (
            <p role="status" style={{ fontSize: 12, color: "var(--mut)", margin: "0 0 8px" }}>{t("hoWillMove", { count: count.movable })}</p>
          ) : null}
          {form.fromOfficerId && count.kind === "ok" && count.staysBehind > 0 ? (
            <p role="status" style={{ fontSize: 12, color: "var(--mut)", margin: "0 0 8px" }}>{t("hoStaysBehind", { count: count.staysBehind })}</p>
          ) : null}
          <Button
            disabled={saving || handoverConfirm.busy || !form.fromOfficerId || !form.toOfficerId || count.kind !== "ok" || count.movable === 0}
            onClick={onHandoverClick}
          >
            {saving ? "Handing over…" : "Hand over charge"}
          </Button>
        </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="card-h"><h3>Handover history</h3></div>
        {loading ? (
          <p className="pad" style={{ textAlign: "center", color: "var(--mut)" }}>Loading…</p>
        ) : historyFailed ? (
          <div className="pad">
            <ErrorState error={toHumanError("load", { area: "handover history" })} onRetry={() => void load()} />
          </div>
        ) : rows.length === 0 ? (
          <p className="pad" style={{ color: "var(--mut)" }}>No handovers recorded.</p>
        ) : (
          <DataTable<Handover>
            columns={[
              { key: "fromOfficerId", label: "From", render: (h) => <>{label(h.fromOfficerId)}</> },
              { key: "toOfficerId", label: "To", render: (h) => <>{label(h.toOfficerId)}</> },
              { key: "reason", label: "Reason", render: (h) => <>{reasonLabel(h.reason)}</> },
              { key: "fileCount", label: "Files moved" },
              { key: "status", label: "Status", render: (h) => <StatusPill status={h.status} /> },
            ]}
            rows={rows}
          />
        )}
      </div>

      <ConfirmDialog
        open={handoverConfirm.open}
        title="Hand over this officer's entire file charge?"
        description={`This reassigns ${
          count.kind === "ok" ? `all ${count.movable} file${count.movable === 1 ? "" : "s"}` : "the files"
        } currently on ${label(form.fromOfficerId)}'s desk to ${label(form.toOfficerId)} (reason: ${reasonLabel(form.reason)}). Charge transfer takes effect once processed and cannot be undone from here.`}
        confirmLabel="Hand over charge"
        danger
        busy={handoverConfirm.busy}
        errorMessage={handoverConfirm.error}
        onConfirm={handoverConfirm.confirm}
        onCancel={handoverConfirm.cancel}
      />
    </div>
  );
}
