"use client";
/**
 * StewardQueuePanel — CDP identity-resolution merge review queue.
 *
 * The matching engine flags pairs of profiles it suspects are the same
 * person/entity (source → target, with a confidence score and a reason).
 * A steward "decides" each pending pair:
 *   - Approve — merges the two profiles for real: attributes are combined,
 *     the target's identities are reassigned onto the source, and the
 *     target is marked merged. Irreversible, so it is gated behind
 *     ConfirmDialog (via ActionButton) and requires a reason.
 *   - Reject  — closes the suggestion; no profile data changes. Still
 *     terminal (a rejected row cannot be re-decided), so it is gated the
 *     same way.
 *
 * Both actions call the identical POST /v1/cdp/steward/decide endpoint,
 * which only differs by `decision`. The endpoint responds 202 Accepted and
 * hands off to a queue consumer — see services/cdp-service/src/modules/
 * steward/consumer.ts — so a freshly-decided row may still read "pending"
 * for a moment. Decided rows are tracked locally (submittedIds), persisted
 * to sessionStorage and reconciled against the server on refresh/poll, so a
 * reload or consumer lag cannot re-offer a decision on a row already acted on
 * (GAP-CDP-STEWARD-03).
 *
 * GAP-CDP-STEWARD-01: Approve/Reject are only rendered when `canDecide` is
 * true (the server-side steward-role gate from page.tsx). cdp-service's
 * POST /v1/cdp/steward/decide is the real authority (403 otherwise); this is
 * defence-in-depth so a non-steward is never offered the control.
 *
 * GAP-CDP-STEWARD-02: before approving an irreversible merge the steward sees
 * each profile's name, type and a couple of masked identifying attributes —
 * in the queue row AND in the confirm dialog — not two opaque UUID prefixes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ActionButton,
  ConfidenceBar,
  DataTable,
  EmptyState,
  ErrorState,
  Masked,
  SkeletonRow,
  StatusPill,
} from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import {
  getStewardQueue,
  decideMerge,
  getProfileSummary,
  summaryAttr,
  profileDisplayName,
  type MergeCandidate,
  type ProfileSummary,
} from "@/lib/cdp/steward";

function confidencePercent(confidence: string): number | null {
  const value = Number(confidence);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

const SUBMITTED_KEY_PREFIX = "cdp.steward.submitted";
const POLL_INTERVAL_MS = 5000;
const MAX_POLLS = 12; // ~60s of reconciliation before we stop nudging

function submittedStorageKey(tenantId: string | null): string {
  return `${SUBMITTED_KEY_PREFIX}:${tenantId ?? "unknown"}`;
}

function readSubmitted(tenantId: string | null): Set<string> {
  try {
    if (typeof sessionStorage === "undefined") return new Set();
    const raw = sessionStorage.getItem(submittedStorageKey(tenantId));
    if (!raw) return new Set();
    const ids = JSON.parse(raw) as unknown;
    return Array.isArray(ids) ? new Set(ids.filter((v): v is string => typeof v === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function persistSubmitted(tenantId: string | null, ids: Set<string>): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(submittedStorageKey(tenantId), JSON.stringify([...ids]));
  } catch {
    /* storage unavailable (private mode / quota) — in-memory state still holds for this session */
  }
}

/** A profile column: name (bold), type, two masked attributes, and a short-id link. */
function ProfileCell({ id, summary }: { id: string; summary: ProfileSummary | null | undefined }) {
  const email = summaryAttr(summary, "email");
  const phone = summaryAttr(summary, "phone");
  const unavailable = summary === null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 160 }}>
      <strong style={{ fontSize: "0.85rem" }}>{profileDisplayName(summary, id)}</strong>
      <span style={{ fontSize: "0.72rem", color: "var(--muted, #6b7280)" }}>
        {unavailable ? "details unavailable" : summary?.profileType ?? "—"}
      </span>
      {email && (
        <span style={{ fontSize: "0.72rem" }}>
          <Masked value={email} kind="email" ariaLabel="masked email" />
        </span>
      )}
      {phone && (
        <span style={{ fontSize: "0.72rem" }}>
          <Masked value={phone} kind="phone" ariaLabel="masked phone" />
        </span>
      )}
      <Link href={`/cdp/profiles/${id}`} target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: "0.7rem" }}>
        View {id.slice(0, 8)}…
      </Link>
    </div>
  );
}

/** Side-by-side comparison rendered inside the confirm dialog (ReactNode). */
function MergeComparison({
  source,
  target,
}: {
  source: { id: string; summary: ProfileSummary | null | undefined };
  target: { id: string; summary: ProfileSummary | null | undefined };
}) {
  const columns: Array<{ label: string; who: { id: string; summary: ProfileSummary | null | undefined } }> = [
    { label: "Kept (source)", who: source },
    { label: "Merged in (target)", who: target },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, margin: "8px 0" }}>
      {columns.map(({ label, who }) => {
        const email = summaryAttr(who.summary, "email");
        const phone = summaryAttr(who.summary, "phone");
        const city = summaryAttr(who.summary, "city");
        return (
          <div key={label} style={{ border: "1px solid var(--line, #e5e7eb)", borderRadius: 8, padding: 8 }}>
            <div style={{ fontSize: "0.7rem", color: "var(--muted, #6b7280)", textTransform: "uppercase" }}>{label}</div>
            <div style={{ fontWeight: 600 }}>{profileDisplayName(who.summary, who.id)}</div>
            <div style={{ fontSize: "0.72rem", color: "var(--muted, #6b7280)" }}>
              {who.summary === null ? "details unavailable" : who.summary?.profileType ?? "—"}
            </div>
            {email && (
              <div style={{ fontSize: "0.72rem" }}>
                Email: <Masked value={email} kind="email" ariaLabel="masked email" />
              </div>
            )}
            {phone && (
              <div style={{ fontSize: "0.72rem" }}>
                Phone: <Masked value={phone} kind="phone" ariaLabel="masked phone" />
              </div>
            )}
            {city && <div style={{ fontSize: "0.72rem" }}>City: {city}</div>}
            <div className="mono" style={{ fontSize: "0.68rem", color: "var(--muted, #6b7280)" }}>{who.id.slice(0, 8)}…</div>
          </div>
        );
      })}
    </div>
  );
}

export function StewardQueuePanel({ canDecide = false }: { canDecide?: boolean }) {
  const [items, setItems] = useState<MergeCandidate[]>([]);
  const [source, setSource] = useState<"loading" | "api" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [submittedIds, setSubmittedIds] = useState<Set<string>>(new Set());
  const [summaries, setSummaries] = useState<Record<string, ProfileSummary | null>>({});
  const tenantIdRef = useRef<string | null>(null);
  const pollCountRef = useRef(0);

  // Fetch (once) the display summary for any profile id we don't have yet.
  const loadSummaries = useCallback(async (rows: MergeCandidate[]) => {
    const ids = new Set<string>();
    for (const r of rows) {
      ids.add(r.sourceProfileId);
      ids.add(r.targetProfileId);
    }
    setSummaries((prev) => {
      const missing = [...ids].filter((id) => !(id in prev));
      if (missing.length === 0) return prev;
      void Promise.all(
        missing.map(async (id) => {
          const summary = await getProfileSummary(id);
          setSummaries((cur) => ({ ...cur, [id]: summary }));
        }),
      );
      return prev;
    });
  }, []);

  const load = useCallback(
    async (isLive: () => boolean = () => true) => {
      setSource("loading");
      setMessage(null);
      const { data, source: s } = await getStewardQueue();
      // Skip if the panel unmounted (or a newer load superseded this one)
      // while the request was in flight.
      if (!isLive()) return;
      if (data[0]?.tenantId) tenantIdRef.current = data[0].tenantId;
      setItems(data);
      // GAP-CDP-STEWARD-03: do NOT blow away submittedIds on refresh/reload.
      // Reconcile instead — keep an id submitted while the server still reads
      // it as pending (consumer lag), and only drop it once the server shows a
      // terminal status, so a lagging row can never be re-offered for decision.
      setSubmittedIds((prev) => {
        const persisted = readSubmitted(tenantIdRef.current);
        const union = new Set<string>([...prev, ...persisted]);
        const next = new Set<string>();
        for (const row of data) {
          if (union.has(row.id) && row.status === "pending") next.add(row.id);
        }
        persistSubmitted(tenantIdRef.current, next);
        return next;
      });
      setSource(s);
      if (s === "api") void loadSummaries(data);
    },
    [loadSummaries],
  );

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => {
      live = false;
    };
  }, [load]);

  // GAP-CDP-STEWARD-03: while any submitted row is still pending server-side,
  // poll the queue so it flips to its real state without a manual refresh.
  // Bounded so we never poll forever.
  useEffect(() => {
    if (submittedIds.size === 0) {
      pollCountRef.current = 0;
      return;
    }
    if (pollCountRef.current >= MAX_POLLS) return;
    let live = true;
    const timer = setTimeout(() => {
      pollCountRef.current += 1;
      void load(() => live);
    }, POLL_INTERVAL_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [submittedIds, load]);

  const handleDecide = useCallback(
    async (candidate: MergeCandidate, decision: "approve" | "reject", reason?: string) => {
      await decideMerge(candidate.id, decision, reason);
      setSubmittedIds((prev) => {
        const next = new Set(prev).add(candidate.id);
        persistSubmitted(tenantIdRef.current, next);
        return next;
      });
      const sourceName = profileDisplayName(summaries[candidate.sourceProfileId], candidate.sourceProfileId);
      const targetName = profileDisplayName(summaries[candidate.targetProfileId], candidate.targetProfileId);
      setMessage(
        decision === "approve"
          ? `Approved — ${targetName} will be merged into ${sourceName} shortly.`
          : "Rejected — this pair will not be merged.",
      );
    },
    [summaries],
  );

  const loading = source === "loading";
  const pendingCount = items.filter((i) => i.status === "pending" && !submittedIds.has(i.id)).length;

  // GAP-CDP-STEWARD-05: Refresh + pending count live above the empty/non-empty
  // ternary so an empty queue can still be re-polled.
  const toolbar = source !== "error" && !loading && (
    <div className="pad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
      <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--muted, #6b7280)" }}>
        {pendingCount} awaiting decision
      </p>
      <button type="button" className="btn ghost" onClick={() => void load()}>Refresh</button>
    </div>
  );

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-h"><h3>Merge review queue</h3></div>

      <div role="status" aria-live="polite">
        {message && (
          <p className="pad" style={{ color: "var(--good)", fontSize: "0.875rem", paddingBottom: 0 }}>
            {message}
          </p>
        )}
      </div>

      {source === "error" ? (
        <div className="pad">
          <ErrorState error={toHumanError("load", { area: "merge review queue" })} onRetry={() => void load()} />
        </div>
      ) : loading ? (
        <div className="pad" aria-busy="true" aria-live="polite" style={{ display: "grid", gap: 10 }}>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : items.length === 0 ? (
        <>
          {toolbar}
          <EmptyState
            icon="✅"
            title="No merge suggestions"
            message="Profiles flagged as possible duplicates will appear here for review."
            action={
              <button type="button" className="btn ghost" onClick={() => void load()}>Refresh</button>
            }
          />
        </>
      ) : (
        <>
          {toolbar}
          <DataTable<MergeCandidate>
            caption="Profile pairs flagged as possible duplicates, awaiting steward decision"
            columns={[
              {
                key: "sourceProfileId",
                label: "Source profile",
                render: (row) => <ProfileCell id={row.sourceProfileId} summary={summaries[row.sourceProfileId]} />,
              },
              {
                key: "targetProfileId",
                label: "Target profile",
                render: (row) => <ProfileCell id={row.targetProfileId} summary={summaries[row.targetProfileId]} />,
              },
              {
                key: "confidence",
                label: "Confidence",
                render: (row) => {
                  const pct = confidencePercent(row.confidence);
                  return (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 96 }}>
                      <ConfidenceBar value={pct === null ? 0 : pct / 100} />
                      <span className="mono" style={{ fontSize: "0.75rem" }}>{pct === null ? "—" : `${pct}%`}</span>
                    </div>
                  );
                },
              },
              {
                key: "matchReason",
                label: "Why flagged",
                render: (row) => <>{row.matchReason ?? "—"}</>,
              },
              {
                key: "status",
                label: "Status",
                render: (row) => (
                  <StatusPill status={row.status} label={submittedIds.has(row.id) ? "Submitted…" : undefined} />
                ),
              },
              {
                key: "id",
                label: "Decision",
                sortable: false,
                render: (row) => {
                  const actionable = canDecide && row.status === "pending" && !submittedIds.has(row.id);
                  if (!actionable) {
                    return (
                      <span className="mono" style={{ fontSize: "0.75rem", color: "var(--muted, #6b7280)" }}>
                        {row.decisionReason ?? "—"}
                      </span>
                    );
                  }
                  const sourceName = profileDisplayName(summaries[row.sourceProfileId], row.sourceProfileId);
                  const targetName = profileDisplayName(summaries[row.targetProfileId], row.targetProfileId);
                  return (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <ActionButton
                        label="Approve merge"
                        className="btn primary"
                        confirmTitle="Approve this merge?"
                        confirmDescription={
                          <>
                            <p style={{ marginTop: 0 }}>
                              This permanently merges <strong>{targetName}</strong> into <strong>{sourceName}</strong>:
                              their identities are reassigned and attributes combined onto the source profile. This
                              cannot be undone.
                            </p>
                            <MergeComparison
                              source={{ id: row.sourceProfileId, summary: summaries[row.sourceProfileId] }}
                              target={{ id: row.targetProfileId, summary: summaries[row.targetProfileId] }}
                            />
                          </>
                        }
                        confirmLabel="Approve & merge"
                        requireReason
                        reasonLabel="Reason (why these are the same person)"
                        onConfirm={(reason) => handleDecide(row, "approve", reason)}
                      />
                      <ActionButton
                        label="Reject"
                        className="btn ghost"
                        danger
                        confirmTitle="Reject this merge suggestion?"
                        confirmDescription="This closes the suggestion without changing any profile data. It will not be shown again for review."
                        confirmLabel="Reject"
                        requireReason
                        reasonLabel="Reason for rejection"
                        onConfirm={(reason) => handleDecide(row, "reject", reason)}
                      />
                    </div>
                  );
                },
              },
            ]}
            rows={items}
          />
        </>
      )}
    </div>
  );
}
