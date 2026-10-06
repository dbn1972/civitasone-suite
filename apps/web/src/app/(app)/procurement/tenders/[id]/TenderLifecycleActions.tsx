"use client";

import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { useFormError } from "@/lib/useFormError";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/app/_components/ds";

export type LifecycleBid = {
  bidId?: string;
  vendorId: string;
  vendorName: string;
  bidAmount?: number;
  technicalScore?: number;
  financialOpened?: boolean;
  status: string;
};

/**
 * Tender lifecycle actions. procurement-service (tender/{routes,domain}.ts)
 * supports draft -> published -> technical_evaluation -> financial_evaluation
 * -> awarded with real POST endpoints for publish, technical-evaluation,
 * open-financial and award.
 *
 * GAP-PROCUREMENT-TENDERS-DETAIL-02: the detail query now returns the REAL
 * phase (technical_evaluation / financial_evaluation) instead of the collapsed
 * "evaluation", so every control is gated on the explicit status rather than a
 * guess from whether a bidAmount happens to be visible:
 *   - the technical evaluation form shows only in technical_evaluation;
 *   - "Open financial bids" shows only in technical_evaluation, and only once
 *     at least one bid is technically qualified;
 *   - "Award" shows only in financial_evaluation, and only once every qualified
 *     bid's financial envelope has been opened.
 * The legacy collapsed "evaluation" value is still handled (older cached
 * payloads) by treating it as the technical phase.
 *
 * GAP-PROCUREMENT-TENDERS-DETAIL-03: Award is additionally gated on a
 * server-provided maker-checker decision (canAward / awardBlockReason) — the
 * creator and the technical evaluator see Award disabled with the reason. The
 * backend award consumer re-checks SoD in-txn and 403s a self-award, so this
 * is defence-in-depth + honest UX, never the security boundary. Sanction
 * reference is required before Award can be confirmed.
 *
 * All server errors are mapped to a human sentence (userFacingErrorFromResponse)
 * — never the raw response body.
 */
export function TenderLifecycleActions({
  tenderId,
  status,
  bids,
  canAward = true,
  awardBlockReason,
}: {
  tenderId: string;
  status: string;
  bids: LifecycleBid[];
  /** GAP-PROCUREMENT-TENDERS-DETAIL-03: server-computed maker-checker verdict. */
  canAward?: boolean;
  /** Why Award is blocked (shown as the disabled button's title). */
  awardBlockReason?: string;
}) {
  const router = useRouter();
  const [sanctionRef, setSanctionRef] = useState("");

  const evaluableBids = useMemo(
    () => bids.filter((b): b is LifecycleBid & { bidId: string } => !!b.bidId),
    [bids],
  );

  // Explicit-phase derivation (DETAIL-02). "evaluation" is the legacy collapsed
  // value — treat it as the technical phase so an older payload still works.
  const inTechnical = status === "technical_evaluation" || status === "evaluation";
  const inFinancial = status === "financial_evaluation";

  const qualifiedBids = bids.filter((b) => b.status === "technically_qualified");
  const anyQualified = qualifiedBids.length > 0;
  // Award is only safe once every qualified bid's envelope is open.
  const allQualifiedOpened =
    anyQualified && qualifiedBids.every((b) => b.financialOpened === true || b.bidAmount !== undefined);

  async function publish(): Promise<void> {
    const res = await fetch(`/api/proxy/v1/procurement/tenders/${tenderId}/publish`, { method: "POST" });
    if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
  }

  async function openFinancial(): Promise<void> {
    const res = await fetch(`/api/proxy/v1/procurement/tenders/${tenderId}/open-financial`, { method: "POST" });
    if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
  }

  async function award(): Promise<void> {
    const ref = sanctionRef.trim();
    if (!ref) throw new Error("A sanction reference is required to award this tender.");
    const res = await fetch(`/api/proxy/v1/procurement/tenders/${tenderId}/award`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sanctionRef: ref }),
    });
    if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
  }

  if (status === "draft") {
    return (
      <div className="card pad" style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
        <ActionButton
          label="Publish tender"
          confirmTitle="Publish this tender?"
          confirmDescription="This makes the tender visible to vendors for bidding."
          confirmLabel="Publish"
          onConfirm={publish}
          onSuccess={() => router.refresh()}
        />
      </div>
    );
  }

  if (status === "cancelled" || status === "awarded") {
    return null;
  }

  if (status !== "published" && !inTechnical && !inFinancial) {
    return null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
      {inTechnical && evaluableBids.length > 0 && (
        <TechnicalEvaluationForm tenderId={tenderId} bids={evaluableBids} onDone={() => router.refresh()} />
      )}

      {inTechnical && (
        <div className="card pad" style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
          <ActionButton
            label="Open financial bids"
            disabled={!anyQualified}
            confirmTitle="Open sealed financial bids?"
            confirmDescription="This reveals the financial amount for technically-qualified bids. Do this only after technical evaluation is complete — bids that haven't qualified stay sealed."
            confirmLabel="Open financial bids"
            onConfirm={openFinancial}
            onSuccess={() => router.refresh()}
          />
        </div>
      )}

      {inFinancial && (
        <div className="card pad" style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
          <input
            className="inp"
            placeholder="Sanction reference"
            aria-label="Sanction reference"
            value={sanctionRef}
            onChange={(e) => setSanctionRef(e.target.value)}
            style={{ minHeight: 44, maxWidth: 260 }}
          />
          <ActionButton
            label="Award tender"
            danger
            disabled={!canAward || !allQualifiedOpened || sanctionRef.trim().length === 0}
            className={!canAward ? "btn danger" : undefined}
            confirmTitle="Award this tender?"
            confirmDescription="This awards the tender to the lowest qualifying (L1) bidder and generates a purchase order. This cannot be undone. The approver must be different from both the tender's creator and its technical evaluator."
            confirmLabel="Award"
            requireReason={false}
            onConfirm={award}
            onSuccess={() => router.refresh()}
          />
          {!canAward && awardBlockReason ? (
            <p role="note" style={{ margin: 0, color: "var(--mut)", fontSize: 13, width: "100%", textAlign: "end" }}>
              {awardBlockReason}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

type Decision = "unset" | "qualified" | "disqualified";

function TechnicalEvaluationForm({
  tenderId,
  bids,
  onDone,
}: {
  tenderId: string;
  bids: (LifecycleBid & { bidId: string })[];
  onDone: () => void;
}) {
  // GAP-PROCUREMENT-TENDERS-DETAIL-01: tri-state decision, defaulting to
  // "unset" for any bid not already qualified — so pressing Save on an
  // untouched form can NEVER silently disqualify every pending bidder.
  const [rows, setRows] = useState<Record<string, { decision: Decision; score: string; reason: string }>>(() =>
    Object.fromEntries(
      bids.map((b) => [
        b.bidId,
        {
          decision: (b.status === "technically_qualified" ? "qualified" : "unset") as Decision,
          score: b.technicalScore != null ? String(b.technicalScore) : "",
          reason: "",
        },
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const formError = useFormError("technical evaluation");

  function update(bidId: string, patch: Partial<{ decision: Decision; score: string; reason: string }>) {
    setSaved(false);
    setRows((prev) => ({ ...prev, [bidId]: { ...prev[bidId], ...patch } }));
  }

  // Every bid must have a decision, and every disqualified bid must carry a
  // reason (min 4 chars) for the audit trail.
  const allDecided = bids.every((b) => rows[b.bidId].decision !== "unset");
  const disqualifiedNeedReason = bids.some(
    (b) => rows[b.bidId].decision === "disqualified" && rows[b.bidId].reason.trim().length < 4,
  );
  const canSubmit = allDecided && !disqualifiedNeedReason && !busy;

  const nQualified = bids.filter((b) => rows[b.bidId].decision === "qualified").length;
  const nDisqualified = bids.filter((b) => rows[b.bidId].decision === "disqualified").length;

  async function doSubmit(): Promise<void> {
    const results = bids.map((b) => {
      const row = rows[b.bidId];
      const score = row.score.trim() === "" ? undefined : Math.max(0, Math.min(100, parseInt(row.score, 10) || 0));
      return {
        bidId: b.bidId,
        qualified: row.decision === "qualified",
        score,
        ...(row.decision === "disqualified" && row.reason.trim() ? { notes: row.reason.trim() } : {}),
      };
    });
    const res = await fetch(`/api/proxy/v1/procurement/tenders/${tenderId}/technical-evaluation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ results }),
    });
    if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
  }

  async function onConfirm(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await doSubmit();
      setSaved(true);
      onDone();
    } catch (err) {
      setError(formError.fromException("save", err).message);
      throw err;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card pad">
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "var(--ink)" }}>Technical evaluation</h3>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th scope="col">Vendor</th>
              <th scope="col">Decision</th>
              <th scope="col" style={{ textAlign: "end" }}>Technical score (0–100)</th>
              <th scope="col">Reason (required if disqualified)</th>
            </tr>
          </thead>
          <tbody>
            {bids.map((b) => {
              const row = rows[b.bidId];
              return (
                <tr key={b.bidId}>
                  <td>{b.vendorName}</td>
                  <td>
                    <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", gap: 10 }}>
                      <legend className="sr-only">{b.vendorName} technical decision</legend>
                      <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                        <input
                          type="radio"
                          name={`decision-${b.bidId}`}
                          aria-label={`${b.vendorName} qualified`}
                          checked={row.decision === "qualified"}
                          onChange={() => update(b.bidId, { decision: "qualified" })}
                        />
                        Qualified
                      </label>
                      <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                        <input
                          type="radio"
                          name={`decision-${b.bidId}`}
                          aria-label={`${b.vendorName} disqualified`}
                          checked={row.decision === "disqualified"}
                          onChange={() => update(b.bidId, { decision: "disqualified" })}
                        />
                        Disqualified
                      </label>
                    </fieldset>
                  </td>
                  <td style={{ textAlign: "end" }}>
                    <input
                      type="number"
                      className="inp"
                      min={0}
                      max={100}
                      aria-label={`${b.vendorName} technical score`}
                      value={row.score}
                      onChange={(e) => update(b.bidId, { score: e.target.value })}
                      style={{ width: 80, textAlign: "end" }}
                    />
                  </td>
                  <td>
                    <textarea
                      className="inp"
                      rows={1}
                      aria-label={`${b.vendorName} disqualification reason`}
                      value={row.reason}
                      disabled={row.decision !== "disqualified"}
                      onChange={(e) => update(b.bidId, { reason: e.target.value })}
                      style={{ minWidth: 180 }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!allDecided ? (
        <p role="status" style={{ marginTop: 10, color: "var(--mut)", fontSize: 13 }}>
          Record a decision for every bidder before saving.
        </p>
      ) : null}
      {error ? <p role="alert" style={{ marginTop: 10, color: "var(--bad)", fontSize: 13 }}>{error}</p> : null}
      {saved && !error ? <p role="status" style={{ marginTop: 10, color: "var(--good)", fontSize: 13 }}>Evaluation submitted.</p> : null}
      <div style={{ marginTop: 12 }}>
        <ActionButton
          label="Save technical evaluation"
          disabled={!canSubmit}
          confirmTitle="Submit technical evaluation?"
          confirmDescription={`${nQualified} bidder(s) will be marked qualified and ${nDisqualified} disqualified. Disqualification removes a bidder from this tender.`}
          confirmLabel="Submit"
          onConfirm={onConfirm}
        />
      </div>
    </div>
  );
}
