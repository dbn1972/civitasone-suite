"use client";

import { useState } from "react";
import { Card, ConfirmDialog, EmptyState, StatusPill } from "@/app/_components/ds";
import { fmtDateTime, humanize } from "../../../_data/format";
import type { Minutes } from "../../../_data/types";
import {
  approveMinutes,
  createMinutes,
  fetchMinutes,
  rejectMinutes,
  submitMinutes,
  updateMinutes,
} from "../../../_data/client";

type Props = {
  meetingId: string;
  initialMinutes: Minutes | null;
  minutesReachable: boolean;
};

const monoStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontVariantNumeric: "tabular-nums",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 4,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".13em",
  textTransform: "uppercase",
  color: "var(--ink2)",
};

/** Writes are queued (202) so the read model updates a beat later — poll once after a short wait. */
const REFRESH_DELAY_MS = 900;

export function MinutesPanel({ meetingId, initialMinutes, minutesReachable }: Props) {
  const [minutes, setMinutes] = useState<Minutes | null>(initialMinutes);
  const [content, setContent] = useState(initialMinutes?.content ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "approve" | "reject">(null);
  const [confirmErr, setConfirmErr] = useState<string | undefined>(undefined);

  async function refresh() {
    await new Promise((r) => setTimeout(r, REFRESH_DELAY_MS));
    try {
      const next = await fetchMinutes(meetingId);
      if (next) {
        setMinutes(next);
        setContent(next.content);
      }
    } catch {
      /* keep current on refresh failure */
    }
  }

  async function onCreate() {
    setBusy("create");
    setError(null);
    setToast(null);
    try {
      await createMinutes(meetingId);
      setToast("Minutes draft is being created.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the minutes draft.");
    } finally {
      setBusy(null);
    }
  }

  async function onSaveDraft() {
    if (!minutes) return;
    setBusy("save");
    setError(null);
    setToast(null);
    try {
      await updateMinutes(meetingId, minutes.id, {
        version: minutes.version,
        content,
      });
      setToast("Draft saved.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the draft.");
    } finally {
      setBusy(null);
    }
  }

  async function onSubmit() {
    if (!minutes) return;
    setBusy("submit");
    setError(null);
    setToast(null);
    try {
      await submitMinutes(meetingId, minutes.id, minutes.version);
      setToast("Draft submitted for approval.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit for approval.");
    } finally {
      setBusy(null);
    }
  }

  async function runConfirmed(reason?: string) {
    if (!minutes || !confirm) return;
    setBusy(confirm);
    setConfirmErr(undefined);
    try {
      if (confirm === "approve") {
        await approveMinutes(meetingId, minutes.id, { version: minutes.version });
        setToast("Minutes approved.");
      } else {
        await rejectMinutes(meetingId, minutes.id, {
          version: minutes.version,
          rejectionComments: reason ?? "",
        });
        setToast("Minutes returned to the secretary.");
      }
      setConfirm(null);
      await refresh();
    } catch (err) {
      setConfirmErr(err instanceof Error ? err.message : "Action failed. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  // ── Empty state: no minutes drafted yet ──────────────────────────────────
  if (!minutes) {
    return (
      <>
        {toast && (
          <div className="alert" role="status" style={{ borderColor: "var(--primary)" }}>
            ✓ {toast}
          </div>
        )}
        {error && (
          <div className="alert" role="alert" style={{ borderColor: "#fca5a5", color: "#b91c1c" }}>
            ⚠ {error}
          </div>
        )}
        <Card padding>
          <EmptyState
            icon="📝"
            title={minutesReachable ? "No minutes drafted yet" : "Minutes not drafted yet"}
            message="The secretary drafts the minutes after the meeting. Create the draft to begin the maker-checker workflow."
          />
          <div style={{ marginTop: 12 }}>
            <button type="button" className="btn primary" disabled={busy !== null} onClick={() => void onCreate()}>
              {busy === "create" ? "Creating…" : "Create minutes draft"}
            </button>
          </div>
        </Card>
      </>
    );
  }

  const isDraft = minutes.status === "draft";
  const isSubmitted = minutes.status === "submitted";
  const isApproved = minutes.status === "approved" || minutes.status === "signed" || minutes.status === "circulated";

  return (
    <>
      {toast && (
        <div className="alert" role="status" style={{ borderColor: "var(--primary)" }}>
          ✓ {toast}
        </div>
      )}
      {error && (
        <div className="alert" role="alert" style={{ borderColor: "#fca5a5", color: "#b91c1c" }}>
          ⚠ {error}
        </div>
      )}

      <Card
        title="Minutes"
        link={<StatusPill status={minutes.status} label={humanize(minutes.status)} />}
        padding
      >
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "4px 16px",
            fontSize: 13,
            marginBottom: 14,
          }}
        >
          <dt style={{ color: "var(--ink2)" }}>Drafter (maker)</dt>
          <dd style={monoStyle}>{minutes.createdBy || "—"}</dd>
          <dt style={{ color: "var(--ink2)" }}>Approver (checker)</dt>
          <dd style={monoStyle}>{minutes.approvedBy || "— pending —"}</dd>
          <dt style={{ color: "var(--ink2)" }}>Approved</dt>
          <dd>{minutes.approvedAt ? fmtDateTime(minutes.approvedAt) : "—"}</dd>
          <dt style={{ color: "var(--ink2)" }}>Version</dt>
          <dd style={monoStyle}>v{minutes.currentVersion}</dd>
          {minutes.dscSignerName && (
            <>
              <dt style={{ color: "var(--ink2)" }}>DSC signer</dt>
              <dd>{minutes.dscSignerName}</dd>
            </>
          )}
          {minutes.hashCurrent && (
            <>
              <dt style={{ color: "var(--ink2)" }}>Integrity hash</dt>
              <dd style={{ ...monoStyle, wordBreak: "break-all" }}>{minutes.hashCurrent}</dd>
            </>
          )}
        </dl>

        <p style={{ fontSize: 12.5, color: "var(--ink2)", marginBottom: 10 }}>
          Maker-checker: the secretary drafts and submits; a different chairperson approves. The
          service enforces the approver ≠ drafter separation server-side (approval is a
          chairperson-only route).
        </p>

        {/* Content: editable while draft, read-only otherwise */}
        <label htmlFor="mtg-minutes-content" style={labelStyle}>
          Minutes content
        </label>
        {isDraft ? (
          <textarea
            id="mtg-minutes-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={14}
            style={{
              width: "100%",
              padding: 12,
              borderRadius: 8,
              border: "1px solid var(--line)",
              fontSize: 13.5,
              fontFamily: "inherit",
              lineHeight: 1.6,
            }}
          />
        ) : (
          <div
            id="mtg-minutes-content"
            style={{
              whiteSpace: "pre-wrap",
              padding: 12,
              borderRadius: 8,
              border: "1px solid var(--line2)",
              background: "var(--bg2, #fafafa)",
              fontSize: 13.5,
              lineHeight: 1.6,
              maxHeight: 420,
              overflowY: "auto",
            }}
          >
            {minutes.content || (
              <span style={{ color: "var(--ink2)" }}>The minutes have no content yet.</span>
            )}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          {isDraft && (
            <>
              <button
                type="button"
                className="btn ghost"
                disabled={busy !== null || content === minutes.content}
                onClick={() => void onSaveDraft()}
              >
                {busy === "save" ? "Saving…" : "Save draft"}
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy !== null}
                onClick={() => void onSubmit()}
              >
                {busy === "submit" ? "Submitting…" : "Submit for approval"}
              </button>
            </>
          )}
          {isSubmitted && (
            <>
              <button
                type="button"
                className="btn primary"
                disabled={busy !== null}
                onClick={() => {
                  setConfirmErr(undefined);
                  setConfirm("approve");
                }}
              >
                Approve minutes
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={busy !== null}
                onClick={() => {
                  setConfirmErr(undefined);
                  setConfirm("reject");
                }}
              >
                Return to secretary
              </button>
            </>
          )}
          {isApproved && (
            <span style={{ fontSize: 13, color: "var(--primary-d)", fontWeight: 600 }}>
              ✓ Minutes approved and locked.
            </span>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirm === "approve"}
        title="Approve these minutes?"
        description="Approving locks the minutes, seals the integrity hash chain and records you as the approver. This can only be done by a chairperson who did not draft them."
        confirmLabel="Approve"
        busy={busy !== null}
        errorMessage={confirmErr}
        onConfirm={() => void runConfirmed()}
        onCancel={() => {
          if (busy === null) setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm === "reject"}
        title="Return the minutes to the secretary?"
        description="Record why the minutes are being returned. The secretary will revise and resubmit."
        confirmLabel="Return with comments"
        danger
        requireReason
        reasonLabel="Rejection comments"
        busy={busy !== null}
        errorMessage={confirmErr}
        onConfirm={(reason) => void runConfirmed(reason)}
        onCancel={() => {
          if (busy === null) setConfirm(null);
        }}
      />
    </>
  );
}
