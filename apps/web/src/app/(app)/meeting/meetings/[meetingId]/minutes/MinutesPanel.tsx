"use client";

import { actionErrorText } from "../../../_data/errorText";
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
  /** @deprecated superseded by `notDrafted`; kept for the page's call site. */
  minutesReachable?: boolean;
  /**
   * Whether the backing minutes read is a genuine 404 (not drafted yet) vs an
   * outage (GAP-MEETING-MEETINGS-MEETINGID-MINUTES-05). The Create button is
   * only shown for a true 404 — never during an outage, which would invite a
   * duplicate draft.
   */
  notDrafted?: boolean;
  /** Current signed-in user id (JWT sub) for a maker==checker self-approval warning. */
  currentUserId?: string | null;
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

/**
 * Writes are queued (202) so the read model updates a beat later. Instead of a
 * single fixed sleep (which races the consumer), poll a few times until the
 * record's version/status changes, up to a bounded number of attempts
 * (GAP-MEETING-MEETINGS-MEETINGID-MINUTES-05).
 */
const REFRESH_POLL_MS = 600;
const REFRESH_MAX_ATTEMPTS = 5;

export function MinutesPanel({
  meetingId,
  initialMinutes,
  notDrafted = true,
  currentUserId = null,
}: Props) {
  const [minutes, setMinutes] = useState<Minutes | null>(initialMinutes);
  const [content, setContent] = useState(initialMinutes?.content ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "approve" | "reject" | "submit">(null);
  const [confirmErr, setConfirmErr] = useState<string | undefined>(undefined);

  /**
   * Poll fetchMinutes until the version or status moves past `prev` (or until
   * attempts run out), so the UI reflects the applied write rather than a
   * stale copy. Returns the freshest minutes it saw (and updates state).
   */
  async function refresh(prev?: Minutes | null): Promise<Minutes | null> {
    const baseVersion = prev?.version ?? minutes?.version ?? -1;
    const baseStatus = prev?.status ?? minutes?.status;
    let latest: Minutes | null = prev ?? minutes;
    for (let attempt = 0; attempt < REFRESH_MAX_ATTEMPTS; attempt++) {
      await new Promise((r) => setTimeout(r, REFRESH_POLL_MS));
      try {
        const next = await fetchMinutes(meetingId);
        if (next) {
          latest = next;
          setMinutes(next);
          setContent(next.content);
          if (next.version > baseVersion || next.status !== baseStatus) break;
        }
      } catch {
        /* keep current on a transient refresh failure; try again */
      }
    }
    return latest;
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
      setError(actionErrorText(err));
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
      setError(actionErrorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function onSubmit() {
    if (!minutes || confirm !== "submit") return;
    setBusy("submit");
    setConfirmErr(undefined);
    setToast(null);
    try {
      let current = minutes;
      // GAP-MEETING-MEETINGS-MEETINGID-MINUTES-01: Submit must not drop unsaved
      // edits. If the textarea differs from the saved content, save it first,
      // then poll for the new (higher) version so Submit uses the fresh version
      // and the chairperson sees the text the secretary actually typed.
      if (content !== current.content) {
        await updateMinutes(meetingId, current.id, { version: current.version, content });
        const refreshed = await refresh(current);
        if (refreshed) current = refreshed;
      }
      await submitMinutes(meetingId, current.id, current.version);
      setToast("Draft submitted for approval.");
      setConfirm(null);
      await refresh(current);
    } catch (err) {
      setConfirmErr(actionErrorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function runConfirmed(reason?: string) {
    if (!minutes || !confirm || confirm === "submit") return;
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
      await refresh(minutes);
    } catch (err) {
      setConfirmErr(actionErrorText(err));
    } finally {
      setBusy(null);
    }
  }

  // GAP-MEETING-MEETINGS-MEETINGID-MINUTES-02: a chairperson approving minutes
  // they drafted violates maker-checker. The service enforces this; surface it
  // in the UI too so the chair is warned before trying.
  const selfApproval =
    currentUserId != null && minutes?.createdBy != null && currentUserId === minutes.createdBy;

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
          {notDrafted ? (
            <>
              <EmptyState
                icon="📝"
                title="No minutes drafted yet"
                message="The secretary drafts the minutes after the meeting. Create the draft to begin the maker-checker workflow."
              />
              <div style={{ marginTop: 12 }}>
                <button type="button" className="btn primary" disabled={busy !== null} onClick={() => void onCreate()}>
                  {busy === "create" ? "Creating…" : "Create minutes draft"}
                </button>
              </div>
            </>
          ) : (
            // Outage, NOT a 404 — do not offer Create (would risk a duplicate
            // draft once connectivity returns). Offer a retry instead.
            <EmptyState
              icon="⚠️"
              title="Minutes couldn't be loaded"
              message="Live data couldn't be reached. Reload the page to try again — don't create a new draft, one may already exist."
            />
          )}
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
          <dd>
            {minutes.createdByName ? (
              <>
                <span style={{ fontWeight: 600 }}>{minutes.createdByName}</span>{" "}
                <span style={{ ...monoStyle, fontSize: 12, color: "var(--ink2)" }}>
                  ({minutes.createdBy})
                </span>
              </>
            ) : (
              <span style={monoStyle}>{minutes.createdBy || "—"}</span>
            )}
          </dd>
          <dt style={{ color: "var(--ink2)" }}>Approver (checker)</dt>
          <dd>
            {minutes.approvedBy ? (
              minutes.approvedByName ? (
                <>
                  <span style={{ fontWeight: 600 }}>{minutes.approvedByName}</span>{" "}
                  <span style={{ ...monoStyle, fontSize: 12, color: "var(--ink2)" }}>
                    ({minutes.approvedBy})
                  </span>
                </>
              ) : (
                <span style={monoStyle}>{minutes.approvedBy}</span>
              )
            ) : (
              <span style={{ color: "var(--ink2)" }}>— pending —</span>
            )}
          </dd>
          <dt style={{ color: "var(--ink2)" }}>Approved</dt>
          <dd>{minutes.approvedAt ? fmtDateTime(minutes.approvedAt) : "—"}</dd>
          <dt style={{ color: "var(--ink2)" }}>Version</dt>
          <dd style={monoStyle}>v{minutes.currentVersion}</dd>
          {minutes.dscSignerName && (
            <>
              <dt style={{ color: "var(--ink2)" }}>DSC signer</dt>
              <dd title="The digital signature certificate (DSC) holder who cryptographically signed this record under the IT Act.">
                {minutes.dscSignerName}
              </dd>
            </>
          )}
          {minutes.hashCurrent && (
            <>
              <dt style={{ color: "var(--ink2)" }}>Integrity hash</dt>
              <dd
                style={{ ...monoStyle, wordBreak: "break-all" }}
                title="A tamper-evidence hash chained to the previous version. Any edit after approval changes this value, so it proves the record hasn't been altered."
              >
                {minutes.hashCurrent}
              </dd>
            </>
          )}
        </dl>

        <p style={{ fontSize: 12.5, color: "var(--ink2)", marginBottom: 10 }}>
          Maker-checker: the secretary drafts and submits; a different chairperson approves. The
          service enforces the approver ≠ drafter separation server-side (approval is a
          chairperson-only route).
        </p>

        {/* GAP-MEETING-MEETINGS-MEETINGID-MINUTES-04: a returned draft must
            show WHY it came back so the secretary can act on it. */}
        {isDraft && minutes.rejectionComments && (
          <div
            className="alert"
            role="status"
            style={{ borderColor: "#f59e0b", background: "var(--warnbg)", marginBottom: 12 }}
          >
            <strong>
              Returned by {minutes.rejectedByName ?? "the chairperson"}
              {minutes.rejectedAt ? ` on ${fmtDateTime(minutes.rejectedAt)}` : ""}:
            </strong>{" "}
            {minutes.rejectionComments}
          </div>
        )}

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
                onClick={() => {
                  setConfirmErr(undefined);
                  setConfirm("submit");
                }}
              >
                {busy === "submit" ? "Submitting…" : "Submit for approval"}
              </button>
              {content !== minutes.content && (
                <span style={{ fontSize: 12.5, color: "#b45309", alignSelf: "center" }}>
                  You have unsaved edits — Submit will save them first.
                </span>
              )}
            </>
          )}
          {isSubmitted && (
            selfApproval ? (
              <span style={{ fontSize: 13, color: "var(--ink2)" }}>
                You drafted these minutes — a different chairperson must approve or return them
                (maker-checker). Awaiting their decision.
              </span>
            ) : (
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
            )
          )}
          {isApproved && (
            <span style={{ fontSize: 13, color: "var(--primary-d)", fontWeight: 600 }}>
              ✓ Minutes approved and locked.
            </span>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirm === "submit"}
        title="Submit these minutes for approval?"
        description={
          content !== (minutes?.content ?? "")
            ? "Your unsaved edits will be saved first, then the saved version is submitted to the chairperson for approval. You can't edit again until it's returned."
            : "The saved version is submitted to the chairperson for approval. You can't edit again until it's returned."
        }
        confirmLabel="Save & submit"
        busy={busy !== null}
        errorMessage={confirmErr}
        onConfirm={() => void onSubmit()}
        onCancel={() => {
          if (busy === null) setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm === "approve"}
        title="Approve these minutes?"
        description={
          <>
            Approving locks the minutes, seals the integrity hash chain and records you as the
            approver. This can only be done by a chairperson who did not draft them.
            {selfApproval && (
              <p style={{ color: "#b42318", fontWeight: 600, marginTop: 8 }}>
                ⚠️ You are recorded as the drafter of these minutes. Maker-checker separation means
                the approver must be someone other than the drafter — this will be rejected.
              </p>
            )}
          </>
        }
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
