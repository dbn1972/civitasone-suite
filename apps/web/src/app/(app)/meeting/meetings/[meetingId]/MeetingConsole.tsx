"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog, EmptyState, ErrorState, StatCard, StatGrid, StatusPill } from "@/app/_components/ds";
import type { HumanError } from "@/lib/messages";
import {
  fmtTime,
  humanize,
  meetingPillStatus,
  presentForQuorum,
} from "../../_data/format";
import {
  MAJORITY_RULES,
  VOTE_TYPES,
  type ActiveVote,
  type AgendaItem,
  type LiveAttendance,
  type MajorityRule,
  type Meeting,
  type VotePosition,
  type VoteType,
} from "../../_data/types";
import {
  attendanceCheckIn,
  attendanceCheckOut,
  castVote,
  concludeVote,
  fetchActiveVotes,
  fetchLiveAttendance,
  initiateVote,
  transitionMeeting,
} from "../../_data/client";

type Src = "api" | "error";

type Props = {
  meeting: Meeting;
  agenda: AgendaItem[];
  agendaSource: Src;
  initialAttendance: LiveAttendance | null;
  attendanceSource: Src;
  initialActiveVotes: ActiveVote[];
  activeVotesSource: Src;
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".13em",
  textTransform: "uppercase",
  color: "var(--ink2)",
  textAlign: "left",
};

const monoStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontVariantNumeric: "tabular-nums",
};

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  borderRadius: 8,
  border: "1px solid var(--line)",
  fontSize: 13.5,
  fontFamily: "inherit",
};

/** Contextual next state-machine transitions the console offers (Req 1.3–1.6). */
function nextTransitions(status: string): { toState: string; label: string; danger?: boolean }[] {
  switch (status) {
    case "scheduled":
    case "agenda_locked":
      return [{ toState: "in_progress", label: "Start meeting" }];
    case "in_progress":
      return [{ toState: "adjourned", label: "Adjourn meeting", danger: true }];
    case "adjourned":
      return [{ toState: "minutes_pending", label: "Move to minutes" }];
    default:
      return [];
  }
}

/**
 * Consequence copy for a danger-marked transition's confirmation dialog.
 * Known states get specific, plain-language wording (matching the tone of
 * MinutesPanel's approve-minutes confirmation); any other future
 * danger-marked transition falls back to a generic-but-still-specific line
 * naming the destination state, rather than a blank/omitted description.
 */
function transitionConsequence(toState: string): string {
  switch (toState) {
    case "adjourned":
      return "Adjourning ends the live session — attendance and voting close, and the meeting moves toward minutes. This can't be undone.";
    default:
      return `This moves the meeting to "${humanize(toState)}" and can't be undone.`;
  }
}

const AGENDA_LOAD_ERROR: HumanError = {
  what: "The agenda couldn't be reached.",
  next: "Check your connection and try again.",
  actions: ["retry", "help"],
};

const VOTES_LOAD_ERROR: HumanError = {
  what: "The voting panel couldn't be reached.",
  next: "Check your connection and try again.",
  actions: ["retry", "help"],
};

const ATTENDANCE_LOAD_ERROR: HumanError = {
  what: "The live attendance dashboard couldn't be reached.",
  next: "Check your connection and try again.",
  actions: ["retry", "help"],
};

function TallyBar({
  votesFor,
  votesAgainst,
  votesAbstain,
}: {
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
}) {
  const total = votesFor + votesAgainst + votesAbstain;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  return (
    <div style={{ marginTop: 8 }}>
      <div
        style={{
          display: "flex",
          height: 10,
          borderRadius: 6,
          overflow: "hidden",
          background: "var(--line2)",
        }}
        aria-hidden
      >
        <div style={{ width: `${pct(votesFor)}%`, background: "#16a34a" }} />
        <div style={{ width: `${pct(votesAgainst)}%`, background: "#dc2626" }} />
        <div style={{ width: `${pct(votesAbstain)}%`, background: "#9ca3af" }} />
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 6, fontSize: 12.5, ...monoStyle }}>
        <span style={{ color: "#16a34a" }}>For {votesFor}</span>
        <span style={{ color: "#dc2626" }}>Against {votesAgainst}</span>
        <span style={{ color: "var(--ink2)" }}>Abstain {votesAbstain}</span>
        <span style={{ color: "var(--ink2)", marginLeft: "auto" }}>Total {total}</span>
      </div>
    </div>
  );
}

export function MeetingConsole({
  meeting,
  agenda,
  agendaSource,
  initialAttendance,
  attendanceSource,
  initialActiveVotes,
  activeVotesSource,
}: Props) {
  const router = useRouter();
  const [status, setStatus] = useState(meeting.status);
  const [attendance, setAttendance] = useState<LiveAttendance | null>(initialAttendance);
  const [attState, setAttState] = useState<Src>(attendanceSource);
  const [votes, setVotes] = useState<ActiveVote[]>(initialActiveVotes);
  const [votesState, setVotesState] = useState<Src>(activeVotesSource);
  /** This browser's own recorded position per resolution (Req: "my vote" indicator).
   *  Set optimistically right after a successful (202-accepted) cast — see the
   *  file-level note on VotePanel for why this is honest, not invented, state. */
  const [myVotes, setMyVotes] = useState<Record<string, VotePosition>>({});

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Danger-transition confirmation (Adjourn meeting, and any future
  // danger-marked transition) — gated the same way MinutesPanel gates
  // approve/reject: a pending choice + its own dialog-scoped error.
  const [pendingTransition, setPendingTransition] = useState<{ toState: string; label: string } | null>(
    null,
  );
  const [transitionErr, setTransitionErr] = useState<string | undefined>(undefined);

  const counts = attendance?.counts ?? {
    present: 0,
    absent: 0,
    joinedLate: 0,
    leftEarly: 0,
    attendingViaVc: 0,
    total: 0,
  };
  const present = presentForQuorum(counts);

  const refreshAttendance = useCallback(async () => {
    try {
      const live = await fetchLiveAttendance(meeting.id);
      setAttendance(live);
      setAttState("api");
    } catch {
      setAttState("error");
    }
  }, [meeting.id]);

  const refreshVotes = useCallback(async () => {
    try {
      const active = await fetchActiveVotes(meeting.id);
      setVotes(active);
      setVotesState("api");
    } catch {
      setVotesState("error");
    }
  }, [meeting.id]);

  async function onTransition(toState: string) {
    setBusy(`transition:${toState}`);
    setError(null);
    setToast(null);
    try {
      await transitionMeeting(meeting.id, toState);
      setStatus(toState as Meeting["status"]);
      setToast(`Meeting moved to “${humanize(toState)}”.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the meeting state.");
    } finally {
      setBusy(null);
    }
  }

  /** Danger-transition path: runs only after the user confirms in the dialog. */
  async function onConfirmTransition() {
    if (!pendingTransition) return;
    const { toState } = pendingTransition;
    setBusy(`transition:${toState}`);
    setTransitionErr(undefined);
    setToast(null);
    try {
      await transitionMeeting(meeting.id, toState);
      setStatus(toState as Meeting["status"]);
      setToast(`Meeting moved to “${humanize(toState)}”.`);
      setPendingTransition(null);
    } catch (err) {
      setTransitionErr(
        err instanceof Error ? err.message : "Could not change the meeting state.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function onCheckIn(participantId: string) {
    setBusy(`checkin:${participantId}`);
    setError(null);
    try {
      await attendanceCheckIn(meeting.id, participantId);
      await refreshAttendance();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check-in failed.");
    } finally {
      setBusy(null);
    }
  }

  async function onCheckOut(participantId: string) {
    setBusy(`checkout:${participantId}`);
    setError(null);
    try {
      await attendanceCheckOut(meeting.id, participantId);
      await refreshAttendance();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check-out failed.");
    } finally {
      setBusy(null);
    }
  }

  const transitions = nextTransitions(status);

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

      {/* Meeting header + lifecycle */}
      <Card padding>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 14,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <StatusPill status={meetingPillStatus(status)} label={humanize(status)} />
            <span style={{ fontSize: 13, color: "var(--ink2)" }}>{humanize(meeting.type)}</span>
            {meeting.venue && (
              <span style={{ fontSize: 13, color: "var(--ink2)" }}>· {meeting.venue}</span>
            )}
            {meeting.vcEnabled && meeting.vcLink && (
              <a href={meeting.vcLink} className="lnk" style={{ fontSize: 13 }} rel="noreferrer">
                Join VC ↗
              </a>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {transitions.map((t) => (
              <button
                key={t.toState}
                type="button"
                className={t.danger ? "btn danger" : "btn primary"}
                disabled={busy !== null}
                onClick={() => {
                  if (t.danger) {
                    setTransitionErr(undefined);
                    setPendingTransition({ toState: t.toState, label: t.label });
                  } else {
                    void onTransition(t.toState);
                  }
                }}
              >
                {busy === `transition:${t.toState}` ? "…" : t.label}
              </button>
            ))}
            <Link className="btn ghost" href={`/meeting/meetings/${meeting.id}/minutes`}>
              Minutes →
            </Link>
          </div>
        </div>
      </Card>

      <StatGrid>
        <StatCard
          icon={meeting.quorumEstablished ? "✅" : "⚠️"}
          iconBg={meeting.quorumEstablished ? "#ecfdf5" : "#fff7ed"}
          label="Quorum"
          value={meeting.quorumEstablished ? "Established" : "Not met"}
        />
        <StatCard
          icon="🟢"
          iconBg="#ecfeff"
          label="Present (for quorum)"
          value={attState === "api" ? present.toLocaleString("en-IN") : "—"}
        />
        <StatCard
          icon="📋"
          iconBg="#eef2ff"
          label="Agenda items"
          value={agendaSource === "api" ? agenda.length.toLocaleString("en-IN") : "—"}
        />
        <StatCard
          icon="🗳️"
          iconBg="#f5f3ff"
          label="Open votes"
          value={votesState === "api" ? votes.length.toLocaleString("en-IN") : "—"}
        />
      </StatGrid>

      {/* Voting panel */}
      <Card
        title={`Live voting (${votesState === "api" ? votes.length : "—"} open)`}
        link={
          <button type="button" className="btn ghost sm" onClick={() => void refreshVotes()}>
            Refresh
          </button>
        }
        padding
      >
        {votesState === "error" ? (
          <ErrorState error={VOTES_LOAD_ERROR} onRetry={() => void refreshVotes()} />
        ) : votes.length === 0 ? (
          <EmptyState
            icon="🗳️"
            title="No motion is open for voting"
            message="Open a resolution below to start a vote. The live tally and result appear here."
          />
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {votes.map((v) => (
              <VotePanel
                key={v.resolutionId}
                meetingId={meeting.id}
                vote={v}
                busy={busy}
                setBusy={setBusy}
                setError={setError}
                setToast={setToast}
                onChanged={refreshVotes}
                myPosition={myVotes[v.resolutionId]}
                onVoted={(position) =>
                  setMyVotes((prev) => ({ ...prev, [v.resolutionId]: position }))
                }
              />
            ))}
          </div>
        )}

        <InitiateVoteForm
          meetingId={meeting.id}
          agenda={agenda}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          setToast={setToast}
          onCreated={refreshVotes}
        />
      </Card>

      {/* Agenda */}
      <Card title={`Agenda (${agendaSource === "api" ? agenda.length : "—"})`} padding>
        {agendaSource === "error" ? (
          // Agenda has no dedicated client-side refetch (unlike attendance/votes
          // below) — router.refresh() re-runs the server component that loads
          // it, which is a genuine retry, just coarser (it also re-fetches
          // meeting/attendance/votes props).
          <ErrorState error={AGENDA_LOAD_ERROR} onRetry={() => router.refresh()} />
        ) : agenda.length === 0 ? (
          <EmptyState
            icon="📋"
            title="No agenda items yet"
            message="Items proposed for this meeting will appear here in order."
          />
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {[...agenda]
              .sort((a, b) => a.sequence - b.sequence)
              .map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                    padding: "10px 0",
                    borderBottom: "1px solid var(--line2)",
                  }}
                >
                  <div
                    style={{
                      ...monoStyle,
                      minWidth: 28,
                      color: "var(--ink2)",
                      fontWeight: 700,
                    }}
                  >
                    {item.sequence}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{item.title}</div>
                    {item.description && (
                      <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 2 }}>
                        {item.description}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    {item.category && (
                      <span style={{ fontSize: 12, color: "var(--ink2)" }}>
                        {humanize(item.category)}
                      </span>
                    )}
                    <span style={{ ...monoStyle, fontSize: 12, color: "var(--ink2)" }}>
                      {item.durationMinutes}m
                    </span>
                    <StatusPill status={item.status} label={humanize(item.status)} />
                  </div>
                </div>
              ))}
          </div>
        )}
      </Card>

      {/* Attendance / quorum */}
      <Card
        title="Attendance & quorum"
        link={
          <button type="button" className="btn ghost sm" onClick={() => void refreshAttendance()}>
            Refresh
          </button>
        }
        padding
      >
        {attState === "error" ? (
          <ErrorState error={ATTENDANCE_LOAD_ERROR} onRetry={() => void refreshAttendance()} />
        ) : !attendance || attendance.participants.length === 0 ? (
          <EmptyState
            icon="👥"
            title="No participants recorded"
            message="Invited participants and their check-in status will appear here."
          />
        ) : (
          <>
            <div
              style={{
                display: "flex",
                gap: 16,
                flexWrap: "wrap",
                fontSize: 12.5,
                marginBottom: 12,
                color: "var(--ink2)",
              }}
            >
              <span>
                Present: <strong style={monoStyle}>{counts.present}</strong>
              </span>
              <span>
                Joined late: <strong style={monoStyle}>{counts.joinedLate}</strong>
              </span>
              <span>
                Via VC: <strong style={monoStyle}>{counts.attendingViaVc}</strong>
              </span>
              <span>
                Left early: <strong style={monoStyle}>{counts.leftEarly}</strong>
              </span>
              <span>
                Absent: <strong style={monoStyle}>{counts.absent}</strong>
              </span>
              <span style={{ marginLeft: "auto" }}>
                Counted for quorum: <strong style={monoStyle}>{present}</strong> / {counts.total}
              </span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th style={labelStyle}>Participant</th>
                    <th style={labelStyle}>Role</th>
                    <th style={labelStyle}>Status</th>
                    <th style={labelStyle}>Checked in</th>
                    <th style={labelStyle} />
                  </tr>
                </thead>
                <tbody>
                  {attendance.participants.map((p) => {
                    const inRoom = p.status === "present" || p.status === "joined_late";
                    return (
                      <tr key={p.participantId}>
                        <td>
                          <div style={{ fontWeight: 600, ...monoStyle, fontSize: 12.5 }}>
                            {p.employeeId || p.participantId}
                          </div>
                          {p.isMandatory && (
                            <span style={{ fontSize: 11, color: "#b45309" }}>Mandatory</span>
                          )}
                        </td>
                        <td>{humanize(p.role)}</td>
                        <td>
                          {inRoom ? (
                            <StatusPill status="active" label={humanize(p.status)} />
                          ) : p.status === "absent" ? (
                            <span style={{ color: "var(--ink2)" }}>Absent</span>
                          ) : (
                            <StatusPill status="pending" label={humanize(p.status)} />
                          )}
                        </td>
                        <td style={monoStyle}>{fmtTime(p.checkInAt)}</td>
                        <td style={{ textAlign: "right" }}>
                          {inRoom ? (
                            <button
                              type="button"
                              className="btn ghost sm"
                              disabled={busy !== null}
                              onClick={() => void onCheckOut(p.participantId)}
                            >
                              {busy === `checkout:${p.participantId}` ? "…" : "Check out"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn ghost sm"
                              disabled={busy !== null}
                              onClick={() => void onCheckIn(p.participantId)}
                            >
                              {busy === `checkin:${p.participantId}` ? "…" : "Check in"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <ConfirmDialog
        open={pendingTransition !== null}
        title={`${pendingTransition?.label ?? "Change meeting state"}?`}
        description={pendingTransition ? transitionConsequence(pendingTransition.toState) : undefined}
        confirmLabel={pendingTransition?.label}
        danger
        busy={busy !== null}
        errorMessage={transitionErr}
        onConfirm={() => void onConfirmTransition()}
        onCancel={() => {
          if (busy === null) setPendingTransition(null);
        }}
      />
    </>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

type PanelCtl = {
  busy: string | null;
  setBusy: (v: string | null) => void;
  setError: (v: string | null) => void;
  setToast: (v: string | null) => void;
};

function VotePanel({
  meetingId,
  vote,
  busy,
  setBusy,
  setError,
  setToast,
  onChanged,
  myPosition,
  onVoted,
}: PanelCtl & {
  meetingId: string;
  vote: ActiveVote;
  onChanged: () => Promise<void>;
  /** This browser's own recorded position for this resolution, if any (Req 7). */
  myPosition?: VotePosition;
  onVoted: (position: VotePosition) => void;
}) {
  const secret = vote.voteType === "secret_ballot";
  // Cast is gated behind a confirmation: a ballot can't be changed once cast
  // (see the dialog copy below), so it needs the same protect-from-mistakes
  // treatment as MinutesPanel's approve/reject actions.
  const [confirmPosition, setConfirmPosition] = useState<VotePosition | null>(null);
  const [castErr, setCastErr] = useState<string | undefined>(undefined);

  async function castConfirmed() {
    if (!confirmPosition) return;
    const position = confirmPosition;
    setBusy(`cast:${vote.resolutionId}:${position}`);
    setCastErr(undefined);
    setToast(null);
    try {
      await castVote(meetingId, { resolutionId: vote.resolutionId, position });
      setToast("Ballot recorded.");
      setConfirmPosition(null);
      // The 202-accepted write queues the ballot; the read model (active
      // votes / results) only reflects it a beat later and never exposes
      // "my own position" per resolution today (Req 7 note: this is the one
      // bit of genuinely fabricated-looking state in this file, and it
      // isn't — it mirrors the SAME optimistic-on-202 pattern already used
      // for the toast above. It resets on reload; a server-confirmed
      // equivalent needs the vote read model to add a myPosition field).
      onVoted(position);
      await onChanged();
    } catch (err) {
      setCastErr(err instanceof Error ? err.message : "Could not record the ballot.");
    } finally {
      setBusy(null);
    }
  }

  async function conclude() {
    setBusy(`conclude:${vote.resolutionId}`);
    setError(null);
    setToast(null);
    try {
      await concludeVote(meetingId, vote.resolutionId);
      setToast("Vote concluded — result computed.");
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not conclude the vote.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 14 }}>
      <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {vote.resolutionNumber && (
              <span style={{ ...monoStyle, fontSize: 12, color: "var(--ink2)" }}>
                {vote.resolutionNumber}
              </span>
            )}
            <StatusPill status="open" label={humanize(vote.voteType)} />
            <span style={{ fontSize: 12, color: "var(--ink2)" }}>
              {humanize(vote.majorityRule)}
            </span>
          </div>
          <p style={{ fontSize: 14, margin: "8px 0 0", fontWeight: 600 }}>{vote.text}</p>
        </div>
      </div>

      <TallyBar
        votesFor={vote.tally.votesFor}
        votesAgainst={vote.tally.votesAgainst}
        votesAbstain={vote.tally.votesAbstain}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
        {myPosition ? (
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              color: "#16a34a",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            ✓ You voted: {humanize(myPosition)}
          </span>
        ) : (
          <>
            <button
              type="button"
              className="btn ghost sm"
              disabled={busy !== null}
              onClick={() => {
                setCastErr(undefined);
                setConfirmPosition("for");
              }}
            >
              Cast: For
            </button>
            <button
              type="button"
              className="btn ghost sm"
              disabled={busy !== null}
              onClick={() => {
                setCastErr(undefined);
                setConfirmPosition("against");
              }}
            >
              Cast: Against
            </button>
            <button
              type="button"
              className="btn ghost sm"
              disabled={busy !== null}
              onClick={() => {
                setCastErr(undefined);
                setConfirmPosition("abstain");
              }}
            >
              Cast: Abstain
            </button>
          </>
        )}
        <button
          type="button"
          className="btn primary sm"
          disabled={busy !== null}
          onClick={() => void conclude()}
          style={{ marginLeft: "auto" }}
        >
          {busy === `conclude:${vote.resolutionId}` ? "…" : "Conclude vote"}
        </button>
      </div>
      {secret && (
        <p style={{ fontSize: 12, color: "var(--ink2)", marginTop: 8 }}>
          Secret ballot — individual positions are withheld; only the aggregate tally is shown.
        </p>
      )}

      <ConfirmDialog
        open={confirmPosition !== null}
        title={`Cast your vote: ${confirmPosition ? humanize(confirmPosition) : ""}?`}
        description={
          secret
            ? `Casting "${confirmPosition ? humanize(confirmPosition) : ""}" is final and cannot be changed. This is a secret ballot — your individual position is withheld; only the aggregate tally is shown.`
            : `Casting "${confirmPosition ? humanize(confirmPosition) : ""}" records your position against your name in the resolution register. Votes cannot be changed once cast.`
        }
        confirmLabel={`Cast: ${confirmPosition ? humanize(confirmPosition) : ""}`}
        busy={busy !== null}
        errorMessage={castErr}
        onConfirm={() => void castConfirmed()}
        onCancel={() => {
          if (busy === null) setConfirmPosition(null);
        }}
      />
    </div>
  );
}

function InitiateVoteForm({
  meetingId,
  agenda,
  busy,
  setBusy,
  setError,
  setToast,
  onCreated,
}: PanelCtl & { meetingId: string; agenda: AgendaItem[]; onCreated: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [voteType, setVoteType] = useState<VoteType>("show_of_hands");
  const [rule, setRule] = useState<MajorityRule>("simple_majority");
  const [agendaItemId, setAgendaItemId] = useState("");

  const votableAgenda = useMemo(
    () => agenda.filter((a) => a.status === "accepted" || a.status === "proposed"),
    [agenda],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) {
      setError("Enter the resolution text to put to the vote.");
      return;
    }
    setBusy("initiate");
    setError(null);
    setToast(null);
    try {
      await initiateVote(meetingId, {
        resolutionText: text.trim(),
        voteType,
        majorityRule: rule,
        ...(agendaItemId ? { agendaItemId } : {}),
      });
      setToast("Vote opened.");
      setText("");
      setAgendaItemId("");
      setOpen(false);
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the vote.");
    } finally {
      setBusy(null);
    }
  }

  if (!open) {
    return (
      <div style={{ marginTop: 14 }}>
        <button type="button" className="btn ghost sm" onClick={() => setOpen(true)}>
          + Open a vote
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      style={{
        marginTop: 14,
        border: "1px dashed var(--line)",
        borderRadius: 10,
        padding: 14,
        display: "grid",
        gap: 12,
      }}
    >
      <div>
        <label htmlFor="mtg-res-text" style={labelStyle}>
          Resolution text
        </label>
        <textarea
          id="mtg-res-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="Resolved that…"
          style={fieldStyle}
        />
      </div>
      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
        }}
      >
        <div>
          <label htmlFor="mtg-vote-type" style={labelStyle}>
            Vote type
          </label>
          <select
            id="mtg-vote-type"
            value={voteType}
            onChange={(e) => setVoteType(e.target.value as VoteType)}
            style={fieldStyle}
          >
            {VOTE_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="mtg-vote-rule" style={labelStyle}>
            Majority rule
          </label>
          <select
            id="mtg-vote-rule"
            value={rule}
            onChange={(e) => setRule(e.target.value as MajorityRule)}
            style={fieldStyle}
          >
            {MAJORITY_RULES.map((r) => (
              <option key={r} value={r}>
                {humanize(r)}
              </option>
            ))}
          </select>
        </div>
        {votableAgenda.length > 0 && (
          <div>
            <label htmlFor="mtg-vote-agenda" style={labelStyle}>
              Agenda item (optional)
            </label>
            <select
              id="mtg-vote-agenda"
              value={agendaItemId}
              onChange={(e) => setAgendaItemId(e.target.value)}
              style={fieldStyle}
            >
              <option value="">— none —</option>
              {votableAgenda.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.sequence}. {a.title}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="btn primary" disabled={busy !== null}>
          {busy === "initiate" ? "Opening…" : "Open vote"}
        </button>
        <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
