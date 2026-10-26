"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ConfirmDialog, EmptyState, Masked, StatusPill, Tabs, TabPanel } from "@/app/_components/ds";
import type { CaseStatus, CertifiedCopy, CourtCaseDetail, CourtOrder, Hearing } from "../../_data/types";
import { CASE_TRANSITIONS } from "../../_data/types";
import { CertifiedCopiesPanel } from "./CertifiedCopiesPanel";
import {
  casePillStatus,
  fmtDate,
  fmtDateTime,
  hearingPillStatus,
  humanize,
  orderPillStatus,
  todayIso,
} from "../../_data/format";
import {
  fetchCaseHearings,
  fetchCaseOrders,
  recordOrder,
  scheduleHearing,
  submitOrderForApproval,
  transitionCase,
} from "../../_data/client";
import { formatShortId } from "@/lib/formatters";
import { ApproveIssueDialog, RecallDialog, SendBackPanel } from "../../_components/OrderActionDialogs";
import { AdjournDialog, OutcomeDialog } from "../../_components/HearingActionDialogs";

const mono: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontVariantNumeric: "tabular-nums",
};
const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".13em",
  textTransform: "uppercase",
  color: "var(--ink2)",
  textAlign: "left",
};
const fieldStyle: React.CSSProperties = {
  padding: 8,
  borderRadius: 8,
  border: "1px solid var(--line)",
  fontSize: 13.5,
  width: "100%",
};

export function CaseConsole({
  caseDetail,
  initialOrders,
  ordersSource,
  initialHearings,
  hearingsSource,
  initialCertifiedCopies,
  certifiedCopiesSource,
}: {
  caseDetail: CourtCaseDetail;
  initialOrders: CourtOrder[];
  ordersSource: "api" | "error";
  initialHearings: Hearing[];
  hearingsSource: "api" | "error";
  initialCertifiedCopies: CertifiedCopy[];
  certifiedCopiesSource: "api" | "error";
}) {
  const router = useRouter();
  const [orders, setOrders] = useState<CourtOrder[]>(initialOrders);
  const [hearings, setHearings] = useState<Hearing[]>(initialHearings);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setError(null);
  }, []);
  const fail = useCallback((err: unknown, fallback: string) => {
    setError(err instanceof Error ? err.message : fallback);
    setToast(null);
  }, []);

  const reloadOrders = useCallback(async () => {
    try {
      setOrders(await fetchCaseOrders(caseDetail.id));
    } catch {
      /* keep current on reload failure */
    }
  }, [caseDetail.id]);

  const reloadHearings = useCallback(async () => {
    try {
      setHearings(await fetchCaseHearings(caseDetail.id));
    } catch {
      /* keep current on reload failure */
    }
  }, [caseDetail.id]);

  // GAP-COURT-CASES-CASEID-06: tabs instead of six stacked cards, synced to ?tab=.
  const TABS = ["Overview", "Hearings", "Orders", "Certified copies"] as const;
  type TabName = (typeof TABS)[number];
  const tabFromParam = (v: string | null): TabName => {
    const match = TABS.find((t) => t.toLowerCase().replace(/[^a-z]+/g, "-") === v);
    return match ?? "Overview";
  };
  const [tab, setTab] = useState<TabName>(() =>
    typeof window === "undefined"
      ? "Overview"
      : tabFromParam(new URLSearchParams(window.location.search).get("tab")),
  );
  const onTabChange = useCallback(
    (next: string) => {
      const t = next as TabName;
      setTab(t);
      const slug = t.toLowerCase().replace(/[^a-z]+/g, "-");
      const url = new URL(window.location.href);
      url.searchParams.set("tab", slug);
      window.history.replaceState(null, "", url.toString());
    },
    [],
  );

  const tabLabels: Record<TabName, string> = {
    Overview: "Overview",
    Hearings: `Hearings (${hearings.length})`,
    Orders: `Orders (${orders.length})`,
    "Certified copies": `Certified copies (${initialCertifiedCopies.length})`,
  };

  return (
    <>
      {toast && (
        <div className="alert" role="status" style={{ borderColor: "var(--primary)" }}>
          ✓ {toast}
        </div>
      )}
      {error && (
        <div className="alert" role="alert" style={{ borderColor: "var(--badbd)", color: "var(--bad)" }}>
          ⚠ {error}
        </div>
      )}

      <Tabs
        tabs={TABS.map((t) => tabLabels[t])}
        active={tabLabels[tab]}
        onChange={(labelled) => {
          const name = (TABS.find((t) => tabLabels[t] === labelled) ?? "Overview") as TabName;
          onTabChange(name);
        }}
        ariaLabel="Case sections"
        idPrefix="court-case"
      />

      <TabPanel idPrefix="court-case" active={tabLabels[tab]}>
        {tab === "Overview" && (
          <>
            <CaseSummary caseDetail={caseDetail} />
            <LifecyclePanel
              caseDetail={caseDetail}
              onDone={(msg) => {
                flash(msg);
                router.refresh();
              }}
              onError={fail}
            />
            <PartiesPanel caseDetail={caseDetail} />
          </>
        )}
        {tab === "Hearings" && (
          <HearingsPanel
            caseId={caseDetail.id}
            caseLabel={caseDetail.title || caseDetail.cnrNumber || "this case"}
            hearings={hearings}
            source={hearingsSource}
            onDone={async (msg) => {
              flash(msg);
              await reloadHearings();
            }}
            onError={fail}
          />
        )}
        {tab === "Orders" && (
          <OrdersPanel
            caseId={caseDetail.id}
            caseLabel={caseDetail.title || caseDetail.cnrNumber || "this case"}
            orders={orders}
            source={ordersSource}
            onDone={async (msg) => {
              flash(msg);
              await reloadOrders();
            }}
            onError={fail}
          />
        )}
        {tab === "Certified copies" && (
          <CertifiedCopiesPanel
            caseId={caseDetail.id}
            initialCopies={initialCertifiedCopies}
            source={certifiedCopiesSource}
          />
        )}
      </TabPanel>
    </>
  );
}

// ─── Summary ─────────────────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <div style={{ fontSize: 14, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function CaseSummary({ caseDetail }: { caseDetail: CourtCaseDetail }) {
  return (
    <Card title="Case summary" padding>
      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
        }}
      >
        <Field label="CNR" value={<span style={mono}>{caseDetail.cnrNumber || "—"}</span>} />
        <Field label="Filing no." value={<span style={mono}>{caseDetail.filingNumber || "—"}</span>} />
        <Field label="Case type" value={humanize(caseDetail.caseType)} />
        <Field
          label="Status"
          value={
            <StatusPill
              status={casePillStatus(caseDetail.status)}
              label={humanize(caseDetail.status)}
            />
          }
        />
        <Field label="Filed" value={<span style={mono}>{fmtDate(caseDetail.filingDate)}</span>} />
        <Field
          label="SLA target"
          value={<span style={mono}>{fmtDate(caseDetail.targetDisposalDate)}</span>}
        />
        <Field label="Disposed" value={<span style={mono}>{fmtDate(caseDetail.disposalDate)}</span>} />
        <Field label="Version" value={<span style={mono}>v{caseDetail.version}</span>} />
      </div>
    </Card>
  );
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

function LifecyclePanel({
  caseDetail,
  onDone,
  onError,
}: {
  caseDetail: CourtCaseDetail;
  onDone: (msg: string) => void;
  onError: (err: unknown, fallback: string) => void;
}) {
  const nextStates = CASE_TRANSITIONS[caseDetail.status] ?? [];
  const [toStatus, setToStatus] = useState<CaseStatus | "">("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // GAP-COURT-CASES-CASEID-05: disposal/reserved are legally significant,
  // reversible only via appeal — confirm them; disposed/appealed require a
  // recorded reason. Routine moves stay single-click.
  const needsConfirm = toStatus === "disposed" || toStatus === "reserved";
  const needsReason = toStatus === "disposed" || toStatus === "appealed";

  async function doMove(confirmReason?: string) {
    if (!toStatus) return;
    setBusy(true);
    try {
      const effectiveReason = (confirmReason ?? reason).trim();
      await transitionCase(caseDetail.id, {
        toStatus,
        expectedVersion: caseDetail.version,
        ...(effectiveReason ? { reason: effectiveReason } : {}),
      });
      setReason("");
      setToStatus("");
      setConfirming(false);
      onDone(`Case moved to “${humanize(toStatus)}”.`);
    } catch (err) {
      onError(err, "Could not move the case.");
    } finally {
      setBusy(false);
    }
  }

  function onApply() {
    if (!toStatus) return;
    if (needsConfirm) {
      setConfirming(true);
      return;
    }
    void doMove();
  }

  return (
    <Card title="Lifecycle" padding>
      <p style={{ fontSize: 12.5, color: "var(--ink2)", marginBottom: 10 }}>
        Advance the matter along its lifecycle. Only the moves the registry permits from the
        current status are offered; the service enforces the transition and role
        (registrar / court admin / judge) server-side.
      </p>
      {nextStates.length === 0 ? (
        <EmptyState
          icon="🔚"
          title="No further transition"
          message={`A case in “${humanize(caseDetail.status)}” has no onward move from here.`}
        />
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <select
            aria-label="Move to status"
            value={toStatus}
            onChange={(e) => setToStatus(e.target.value as CaseStatus | "")}
            style={{ ...fieldStyle, width: "auto", minWidth: 180 }}
          >
            <option value="">Move to…</option>
            {nextStates.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
          <input
            aria-label="Reason (optional)"
            placeholder="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ ...fieldStyle, width: "auto", flex: "1 1 240px" }}
          />
          <Button
            variant="primary"
            disabled={busy || !toStatus}
            onClick={onApply}
          >
            {busy ? "Moving…" : "Apply transition"}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        danger={toStatus === "disposed"}
        title={toStatus === "disposed" ? "Dispose this case?" : "Reserve this case?"}
        confirmLabel={toStatus === "disposed" ? "Dispose case" : "Reserve case"}
        requireReason={needsReason}
        reasonLabel="Reason"
        description={
          <p>
            Move <strong>{caseDetail.title || "this matter"}</strong>{" "}
            (<span style={mono}>{caseDetail.cnrNumber || "—"}</span>) to{" "}
            <strong>{humanize(toStatus || "")}</strong>.{" "}
            {toStatus === "disposed"
              ? "Disposal is a legal-record event — it can be reversed only through an appeal."
              : "You can still move a reserved matter back to part-heard or on to disposed."}
          </p>
        }
        busy={busy}
        onConfirm={(r) => void doMove(r)}
        onCancel={() => setConfirming(false)}
      />
    </Card>
  );
}

// ─── Parties ─────────────────────────────────────────────────────────────────

function PartiesPanel({ caseDetail }: { caseDetail: CourtCaseDetail }) {
  return (
    <Card title={`Parties (${caseDetail.parties.length})`} padding>
      {caseDetail.parties.length === 0 ? (
        <EmptyState icon="👥" title="No parties recorded" message="No parties are on this case." />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={labelStyle}>Role</th>
                <th style={labelStyle}>Name</th>
                <th style={labelStyle}>Advocate</th>
                <th style={labelStyle}>Bar ID</th>
              </tr>
            </thead>
            <tbody>
              {caseDetail.parties.map((p) => (
                <tr key={p.id}>
                  <td>{humanize(p.partyRole)}</td>
                  <td>{p.name ?? "—"}</td>
                  <td>{p.advocateName ?? "—"}</td>
                  <td style={mono}>
                    {p.advocateBarId ? (
                      <Masked
                        value={p.advocateBarId}
                        kind="last4"
                        ariaLabel={`Advocate Bar ID ending ${p.advocateBarId.slice(-4)}`}
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ─── Hearings ────────────────────────────────────────────────────────────────

function HearingsPanel({
  caseId,
  caseLabel,
  hearings,
  source,
  onDone,
  onError,
}: {
  caseId: string;
  caseLabel: string;
  hearings: Hearing[];
  source: "api" | "error";
  onDone: (msg: string) => Promise<void> | void;
  onError: (err: unknown, fallback: string) => void;
}) {
  const [scheduledAt, setScheduledAt] = useState("");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);

  async function schedule() {
    if (!scheduledAt) return;
    setBusy(true);
    try {
      // datetime-local yields "YYYY-MM-DDTHH:mm"; send as an ISO instant.
      const iso = new Date(scheduledAt).toISOString();
      await scheduleHearing(caseId, {
        scheduledAt: iso,
        ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
      });
      setScheduledAt("");
      setPurpose("");
      await onDone("Hearing scheduled.");
    } catch (err) {
      onError(err, "Could not schedule the hearing.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={`Hearings (${hearings.length})`} padding>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <input
          type="datetime-local"
          aria-label="Hearing date & time"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          style={{ ...fieldStyle, width: "auto" }}
        />
        <input
          aria-label="Purpose (optional)"
          placeholder="Purpose (e.g. arguments)"
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          style={{ ...fieldStyle, width: "auto", flex: "1 1 200px" }}
        />
        <Button
          variant="primary"
          disabled={busy || !scheduledAt}
          onClick={() => void schedule()}
        >
          {busy ? "Scheduling…" : "Schedule hearing"}
        </Button>
      </div>

      {source === "error" ? (
        <EmptyState
          icon="📅"
          title="Could not load hearings"
          message="Live data couldn't be reached. Newly scheduled hearings will appear once it returns."
        />
      ) : hearings.length === 0 ? (
        <EmptyState icon="📅" title="No hearings yet" message="Schedule the first hearing above." />
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {hearings.map((h) => (
            <HearingRow key={h.id} hearing={h} caseId={caseId} caseLabel={caseLabel} onDone={onDone} />
          ))}
        </div>
      )}
    </Card>
  );
}

function HearingRow({
  hearing,
  caseId,
  caseLabel,
  onDone,
}: {
  hearing: Hearing;
  caseId: string;
  caseLabel: string;
  onDone: (msg: string) => Promise<void> | void;
}) {
  const [mode, setMode] = useState<"none" | "adjourn" | "outcome">("none");
  const canAct = hearing.status === "scheduled";
  // Same row label as /court/hearings so both screens name the hearing identically.
  const rowLabel = `hearing on ${fmtDateTime(hearing.scheduledDate)} for ${caseLabel} (#${formatShortId(hearing.id)})`;

  return (
    <div style={{ border: "1px solid var(--line2)", borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {fmtDateTime(hearing.scheduledDate)}
            {hearing.purpose && (
              <span style={{ color: "var(--ink2)", fontWeight: 400 }}> · {humanize(hearing.purpose)}</span>
            )}
          </div>
          {hearing.nextDate && (
            <div style={{ fontSize: 12.5, color: "var(--ink2)", ...mono }}>
              Next date: {fmtDate(hearing.nextDate)}
            </div>
          )}
          {hearing.adjournmentReason && (
            <div style={{ fontSize: 12.5, color: "var(--ink2)" }}>
              Adjourned: {hearing.adjournmentReason}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <StatusPill status={hearingPillStatus(hearing.status)} label={humanize(hearing.status)} />
          {canAct && mode === "none" && (
            <>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Adjourn the ${rowLabel}`}
                onClick={() => setMode("adjourn")}
              >
                Adjourn
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Record outcome for the ${rowLabel}`}
                onClick={() => setMode("outcome")}
              >
                Record outcome
              </Button>
            </>
          )}
        </div>
      </div>

      {/* GAP-COURT-CASES-CASEID-01: the SAME adjourn / outcome dialogs the standalone
          /court/hearings console uses (one component, one UX contract). */}
      {mode === "adjourn" && (
        <AdjournDialog
          hearing={hearing}
          caseId={caseId}
          rowLabel={rowLabel}
          onClose={() => setMode("none")}
          onDone={onDone}
        />
      )}
      {mode === "outcome" && (
        <OutcomeDialog
          hearing={hearing}
          rowLabel={rowLabel}
          onClose={() => setMode("none")}
          onDone={onDone}
        />
      )}
    </div>
  );
}

// ─── Orders + issuance (maker-checker) ───────────────────────────────────────

function OrdersPanel({
  caseId,
  caseLabel,
  orders,
  source,
  onDone,
  onError,
}: {
  caseId: string;
  caseLabel: string;
  orders: CourtOrder[];
  source: "api" | "error";
  onDone: (msg: string) => Promise<void> | void;
  onError: (err: unknown, fallback: string) => void;
}) {
  const [orderType, setOrderType] = useState("");
  const [orderText, setOrderText] = useState("");
  const [orderDate, setOrderDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);

  async function draft() {
    if (!orderType.trim() || !orderText.trim()) return;
    setBusy(true);
    try {
      await recordOrder(caseId, {
        orderType: orderType.trim(),
        orderText: orderText.trim(),
        orderDate,
      });
      setOrderType("");
      setOrderText("");
      await onDone("Order drafted.");
    } catch (err) {
      onError(err, "Could not draft the order.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={`Orders (${orders.length})`} padding>
      <p style={{ fontSize: 12.5, color: "var(--ink2)", marginBottom: 10 }}>
        Orders follow a maker-checker flow: a judicial officer <strong>drafts</strong> an order,
        submits it for approval, and a <strong>different</strong> officer approve-issues it with a
        DSC signature (the service rejects self-approval). Send back returns a pending order to its
        maker; recall withdraws an issued order.
      </p>

      <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <input
            aria-label="Order type"
            placeholder="Order type (e.g. interim, final)"
            value={orderType}
            onChange={(e) => setOrderType(e.target.value)}
            style={{ ...fieldStyle, width: "auto", flex: "1 1 200px" }}
          />
          <input
            type="date"
            aria-label="Order date"
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
            style={{ ...fieldStyle, width: "auto" }}
          />
        </div>
        <textarea
          aria-label="Order text"
          placeholder="Order text…"
          value={orderText}
          onChange={(e) => setOrderText(e.target.value)}
          rows={3}
          style={{ ...fieldStyle, resize: "vertical" }}
        />
        <div>
          <Button
            variant="primary"
            disabled={busy || !orderType.trim() || !orderText.trim()}
            onClick={() => void draft()}
          >
            {busy ? "Drafting…" : "Draft order"}
          </Button>
        </div>
      </div>

      {source === "error" ? (
        <EmptyState
          icon="📜"
          title="Could not load orders"
          message="Live data couldn't be reached. Drafted orders will appear once it returns."
        />
      ) : orders.length === 0 ? (
        <EmptyState icon="📜" title="No orders yet" message="Draft the first order above." />
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {orders.map((o) => (
            <OrderRow key={o.id} order={o} caseLabel={caseLabel} onDone={onDone} onError={onError} />
          ))}
        </div>
      )}
    </Card>
  );
}

function OrderRow({
  order,
  caseLabel,
  onDone,
  onError,
}: {
  order: CourtOrder;
  caseLabel: string;
  onDone: (msg: string) => Promise<void> | void;
  onError: (err: unknown, fallback: string) => void;
}) {
  const [mode, setMode] = useState<"none" | "issue" | "sendback" | "recall" | "submit">("none");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Same row label as /court/orders so both screens name the order identically.
  const rowLabel = `${humanize(order.orderType)} order (${fmtDate(order.orderDate)}) for ${caseLabel} (#${formatShortId(order.id)})`;

  const run = useCallback(
    async (fn: () => Promise<void>, ok: string, bad: string) => {
      setBusy(true);
      try {
        await fn();
        setMode("none");
        await onDone(ok);
      } catch (err) {
        onError(err, bad);
      } finally {
        setBusy(false);
      }
    },
    [onDone, onError],
  );

  return (
    <div style={{ border: "1px solid var(--line2)", borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 320px" }}>
          <div style={{ fontWeight: 600 }}>
            {humanize(order.orderType)}
            <span style={{ color: "var(--ink2)", fontWeight: 400, ...mono }}>
              {" "}· {fmtDate(order.orderDate)}
            </span>
          </div>
          {order.orderText && (
            <div style={{ fontSize: 13, color: "var(--ink2)", marginTop: 2, whiteSpace: "pre-wrap" }}>
              {order.orderText}
            </div>
          )}
          <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 4, ...mono }}>
            v{order.version}
            {order.hasDsc && " · DSC signed"}
            {order.issuedAt && ` · issued ${fmtDateTime(order.issuedAt)}`}
            {order.recallReason && ` · recalled: ${order.recallReason}`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
          <StatusPill status={orderPillStatus(order.status)} label={humanize(order.status)} />
          {mode === "none" && order.status === "draft" && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Submit the ${rowLabel} for approval`}
              onClick={() => setMode("submit")}
            >
              Submit for approval
            </Button>
          )}
          {mode === "none" && order.status === "pending_approval" && (
            <>
              <Button
                variant="primary"
                size="sm"
                aria-label={`Approve and issue the ${rowLabel}`}
                onClick={() => setMode("issue")}
              >
                Approve &amp; issue
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Send back the ${rowLabel}`}
                onClick={() => setMode("sendback")}
              >
                Send back
              </Button>
            </>
          )}
          {mode === "none" && order.status === "issued" && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Recall the ${rowLabel}`}
              onClick={() => setMode("recall")}
            >
              Recall
            </Button>
          )}
        </div>
      </div>

      {/* GAP-COURT-CASES-CASEID-01: submit-for-approval via ConfirmDialog so the
          action is not single-click — consistent with approve/sendback/recall. */}
      {mode === "submit" && (
        <ConfirmDialog
          open
          title="Submit this order for approval?"
          confirmLabel="Confirm submit"
          description={
            <p>
              The order will move to <strong>pending approval</strong>. A different officer
              must then approve and issue it (self-approval is rejected by the service).
            </p>
          }
          busy={busy}
          errorMessage={submitError ?? undefined}
          onConfirm={() => {
            setSubmitError(null);
            void run(
              async () => {
                try {
                  await submitOrderForApproval(order.id, order.version);
                } catch (err) {
                  setSubmitError("Could not submit the order. Please try again.");
                  throw err;
                }
              },
              "Order submitted for approval.",
              "Could not submit the order.",
            );
          }}
          onCancel={() => {
            setSubmitError(null);
            setMode("none");
          }}
        />
      )}

      {/* The SAME approve & issue / send back / recall components the standalone
          /court/orders console uses (one component, one UX contract). */}
      {mode === "issue" && (
        <ApproveIssueDialog order={order} rowLabel={rowLabel} onClose={() => setMode("none")} onDone={onDone} />
      )}
      {mode === "sendback" && (
        <SendBackPanel order={order} onClose={() => setMode("none")} onDone={onDone} />
      )}
      {mode === "recall" && (
        <RecallDialog order={order} rowLabel={rowLabel} onClose={() => setMode("none")} onDone={onDone} />
      )}
    </div>
  );
}
