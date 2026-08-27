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
 * for a moment. Rather than mis-report a final state, decided rows are
 * tracked locally (submittedIds) to disable their actions immediately; the
 * manual Refresh pulls the server's actual state once the consumer catches
 * up.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ActionButton, ConfidenceBar, DataTable, EmptyState, ErrorState, StatusPill } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { getStewardQueue, decideMerge, type MergeCandidate } from "@/lib/cdp/steward";

function confidencePercent(confidence: string): number | null {
  const value = Number(confidence);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

function ProfileLink({ id }: { id: string }) {
  return (
    <Link href={`/cdp/profiles/${id}`} className="mono">
      {id.slice(0, 8)}…
    </Link>
  );
}

export function StewardQueuePanel() {
  const [items, setItems] = useState<MergeCandidate[]>([]);
  const [source, setSource] = useState<"loading" | "api" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [submittedIds, setSubmittedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setSource("loading");
    setMessage(null);
    const { data, source: s } = await getStewardQueue();
    setItems(data);
    setSubmittedIds(new Set());
    setSource(s);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDecide = useCallback(
    async (candidate: MergeCandidate, decision: "approve" | "reject", reason?: string) => {
      await decideMerge(candidate.id, decision, reason);
      setSubmittedIds((prev) => new Set(prev).add(candidate.id));
      setMessage(
        decision === "approve"
          ? `Approved — ${candidate.sourceProfileId.slice(0, 8)}… and ${candidate.targetProfileId.slice(0, 8)}… will be merged shortly.`
          : "Rejected — this pair will not be merged.",
      );
    },
    [],
  );

  const loading = source === "loading";
  const pendingCount = items.filter((i) => i.status === "pending" && !submittedIds.has(i.id)).length;

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
        <p className="pad" style={{ textAlign: "center", color: "#94a3b8" }}>Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon="✅"
          title="No merge suggestions"
          message="Profiles flagged as possible duplicates will appear here for review."
        />
      ) : (
        <>
          <div className="pad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--muted, #6b7280)" }}>
              {pendingCount} awaiting decision
            </p>
            <button type="button" className="btn ghost" onClick={() => void load()}>Refresh</button>
          </div>
          <DataTable<MergeCandidate>
            caption="Profile pairs flagged as possible duplicates, awaiting steward decision"
            columns={[
              {
                key: "sourceProfileId",
                label: "Source profile",
                render: (row) => <ProfileLink id={row.sourceProfileId} />,
              },
              {
                key: "targetProfileId",
                label: "Target profile",
                render: (row) => <ProfileLink id={row.targetProfileId} />,
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
                  const actionable = row.status === "pending" && !submittedIds.has(row.id);
                  if (!actionable) {
                    return (
                      <span className="mono" style={{ fontSize: "0.75rem", color: "var(--muted, #6b7280)" }}>
                        {row.decisionReason ?? "—"}
                      </span>
                    );
                  }
                  return (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <ActionButton
                        label="Approve merge"
                        className="btn primary"
                        confirmTitle="Approve this merge?"
                        confirmDescription={
                          <>
                            This permanently merges profile{" "}
                            <strong className="mono">{row.targetProfileId.slice(0, 8)}…</strong> into{" "}
                            <strong className="mono">{row.sourceProfileId.slice(0, 8)}…</strong>: their identities are
                            reassigned and attributes combined onto the source profile. This cannot be undone.
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
