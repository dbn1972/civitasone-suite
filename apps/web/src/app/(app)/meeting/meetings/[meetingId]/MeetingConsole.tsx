"use client";

import { actionErrorText } from "../../_data/errorText";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, ConfirmDialog, EmptyState, ErrorState, StatCard, StatGrid, StatusPill } from "@/app/_components/ds";
import { EmployeePicker } from "@/app/_components/EmployeePicker";
import type { HumanError } from "@/lib/messages";
import { isUuid, unresolvedLabel, type PersonRef } from "@/lib/records/labels";
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
  addAgendaItem,
  addParticipants,
  listCommitteeMembers,
  listParticipantEmployeeIds,
  AGENDA_OUTCOME_TYPES,
  PARTICIPANT_ROLES,
  MeetingTransitionError,
  type AgendaOutcomeType,
  type ParticipantRole,
} from "../../_data/client";

type Src = "api" | "error";

/** GAP-MEETING-MEETINGS-MEETINGID-03: caller-scoped permissions derived from session roles. */
type ViewerPermissions = {
  canTransition: boolean;
  canCheckIn: boolean;
  canCast: boolean;
  canConclude: boolean;
  /** M2: may add participants (mirrors meeting-service participant WRITE_ROLES). */
  canManageParticipants?: boolean;
  /** Which employee directory the viewer's roles can search; "none" hides the single-add picker. */
  employeeDirectory?: "hrms" | "payroll" | "none";
};

type Props = {
  meeting: Meeting;
  agenda: AgendaItem[];
  agendaSource: Src;
  initialAttendance: LiveAttendance | null;
  attendanceSource: Src;
  initialActiveVotes: ActiveVote[];
  activeVotesSource: Src;
  /** GAP-MEETING-MEETINGS-MEETINGID-03: session-derived permissions. */
  viewerPermissions: ViewerPermissions;
  /** UX-R5 (names, not ids): participant employee ids resolved server-side to name + designation. */
  people?: Record<string, PersonRef>;
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

/**
 * Contextual next state-machine transitions the console offers (Req 1.3–1.6).
 * UAT J14 / D9: mirrors meeting-service meeting-core/domain.ts BASE_TRANSITIONS.
 * A draft meeting used to offer nothing, and "Start meeting" was offered from
 * `scheduled`, an edge the service refuses (only agenda_locked → in_progress).
 * Minutes approval stays on the minutes page; cancel has its own route.
 * `key` names the label in the meetingLifecycle messages.
 */
export type ConsoleTransition = { toState: string; key: string; danger?: boolean; needsReason?: boolean };
export function nextTransitions(status: string): ConsoleTransition[] {
  switch (status) {
    case "draft":
      return [{ toState: "scheduled", key: "schedule" }];
    case "scheduled":
      return [{ toState: "agenda_locked", key: "lockAgenda" }];
    case "agenda_locked":
      return [{ toState: "in_progress", key: "start" }, { toState: "scheduled", key: "unlockAgenda" }];
    case "in_progress":
      return [
        { toState: "adjourned", key: "adjourn", danger: true, needsReason: true },
        { toState: "minutes_pending", key: "end", danger: true },
      ];
    case "adjourned":
      return [{ toState: "in_progress", key: "resume" }, { toState: "minutes_pending", key: "moveToMinutes", danger: true }];
    case "minutes_approved":
      return [{ toState: "closed", key: "close", danger: true }];
    default:
      return [];
  }
}

/**
 * draft → scheduled prerequisites the service checks (validateDraftToScheduled):
 * a chairperson, at least one agenda item and a future date. Returned as
 * meetingLifecycle message keys so the console can say what is missing instead
 * of offering a button whose command is refused in the worker.
 */
export function scheduleBlockers(
  m: { chairpersonId: string | null; scheduledAt: string | null },
  agendaCount: number,
  now: Date = new Date(),
): string[] {
  const out: string[] = [];
  if (!m.chairpersonId) out.push("needChair");
  if (agendaCount < 1) out.push("needAgenda");
  const at = m.scheduledAt ? Date.parse(m.scheduledAt) : NaN;
  if (!Number.isFinite(at) || at <= now.getTime()) out.push("needFutureDate");
  return out;
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
    case "minutes_pending":
      return "This moves the meeting into the minutes workflow — the live console closes and the secretary begins drafting minutes. This can't be undone.";
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
        <div style={{ width: `${pct(votesFor)}%`, background: "var(--good)" }} />
        <div style={{ width: `${pct(votesAgainst)}%`, background: "var(--bad)" }} />
        <div style={{ width: `${pct(votesAbstain)}%`, background: "var(--mut)" }} />
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 6, fontSize: 12.5, ...monoStyle }}>
        <span style={{ color: "var(--good)" }}>For {votesFor}</span>
        <span style={{ color: "var(--bad)" }}>Against {votesAgainst}</span>
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
  viewerPermissions,
  people = {},
}: Props) {
  const router = useRouter();
  const tl = useTranslations("meetingLifecycle");
  const [status, setStatus] = useState(meeting.status);
  // UAT J14: optimistic-lock version the transition command carries; each
  // accepted transition bumps it by one (meeting-core consumer versionedUpdate).
  const [version, setVersion] = useState(meeting.version);
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
  const [pendingTransition, setPendingTransition] = useState<{ toState: string; label: string; needsReason?: boolean } | null>(
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

  // GAP-MEETING-MEETINGS-MEETINGID-01/04: live polling. While the meeting is
  // in_progress and the tab is visible, re-fetch attendance + active votes on
  // an interval so a quorum/tally on one device doesn't go stale across the
  // several devices in a live room. Pauses while any request/dialog is in
  // flight (busy) and when the tab is hidden; backs off is implicit (one
  // request per tick, skipped while busy).
  const POLL_MS = 8000;
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const busyRef = useRef<string | null>(busy);
  busyRef.current = busy;
  useEffect(() => {
    if (status !== "in_progress") return;
    let cancelled = false;
    async function tick() {
      if (cancelled) return;
      if (busyRef.current !== null) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      await Promise.all([refreshAttendance(), refreshVotes()]);
      if (!cancelled) setLastUpdated(new Date());
    }
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [status, refreshAttendance, refreshVotes]);

  /** A refusal the service explained, in the user's language; anything else via the catalogue. */
  function transitionErrorText(err: unknown): string {
    if (err instanceof MeetingTransitionError) {
      const known = ["MEETING_INVALID_TRANSITION", "MEETING_QUORUM_NOT_MET", "MEETING_SHORT_NOTICE", "VERSION_CONFLICT", "FORBIDDEN"];
      if (known.includes(err.code)) return tl(`err.${err.code}`);
    }
    return actionErrorText(err);
  }

  function applied(toState: string) {
    setStatus(toState as Meeting["status"]);
    setVersion((v) => v + 1);
    setToast(tl("moved", { state: humanize(toState) }));
    router.refresh();
  }

  async function onTransition(toState: string) {
    setBusy(`transition:${toState}`);
    setError(null);
    setToast(null);
    try {
      await transitionMeeting(meeting.id, toState, version);
      applied(toState);
    } catch (err) {
      setError(transitionErrorText(err));
    } finally {
      setBusy(null);
    }
  }

  /** Danger-transition path: runs only after the user confirms in the dialog. */
  async function onConfirmTransition(reason?: string) {
    if (!pendingTransition) return;
    const { toState } = pendingTransition;
    setBusy(`transition:${toState}`);
    setTransitionErr(undefined);
    setToast(null);
    try {
      await transitionMeeting(meeting.id, toState, version, reason);
      applied(toState);
      setPendingTransition(null);
    } catch (err) {
      setTransitionErr(transitionErrorText(err));
    } finally {
      setBusy(null);
    }
  }

  // UAT J14: a draft/scheduled meeting needs agenda items before it can be
  // scheduled; there was no screen to add one.
  const [agendaTitle, setAgendaTitle] = useState("");
  const [agendaOutcome, setAgendaOutcome] = useState<AgendaOutcomeType>("discussion");
  async function onAddAgenda(e: React.FormEvent) {
    e.preventDefault();
    const title = agendaTitle.trim();
    if (!title) return;
    setBusy("agenda:add");
    setError(null);
    setToast(null);
    try {
      await addAgendaItem(meeting.id, { title, outcomeType: agendaOutcome });
      setAgendaTitle("");
      setToast(tl("agendaAdded"));
      router.refresh();
    } catch (err) {
      setError(actionErrorText(err));
    } finally {
      setBusy(null);
    }
  }

  // M2: add participants -- the picked employee, or the meeting committee's active members.
  const [newParticipantId, setNewParticipantId] = useState<string | null>(null);
  const [newParticipantRole, setNewParticipantRole] = useState<ParticipantRole>("member");
  // Employee ids submitted but not yet on the roster: keeps "Add" disabled so a second click cannot
  // resubmit a batch the consumer would reject. Polls the roster; gives up after 30 s.
  const [awaitingIds, setAwaitingIds] = useState<string[]>([]);
  useEffect(() => {
    if (awaitingIds.length === 0) return;
    const onRoster = new Set((attendance?.participants ?? []).map((p) => p.employeeId));
    if (awaitingIds.every((id) => onRoster.has(id))) {
      setAwaitingIds([]);
      return;
    }
    const poll = setInterval(() => void refreshAttendance(), 3000);
    const giveUp = setTimeout(() => setAwaitingIds([]), 30000);
    return () => {
      clearInterval(poll);
      clearTimeout(giveUp);
    };
  }, [awaitingIds, attendance, refreshAttendance]);
  async function onAddParticipant() {
    if (!newParticipantId) return;
    setBusy("participants:add");
    setError(null);
    setToast(null);
    try {
      if ((await listParticipantEmployeeIds(meeting.id)).includes(newParticipantId)) {
        setToast(tl("committeeAlreadyAdded"));
        return;
      }
      await addParticipants(meeting.id, [{ employeeId: newParticipantId, role: newParticipantRole }]);
      setAwaitingIds([newParticipantId]);
      setNewParticipantId(null);
      setToast(tl("participantsSubmitted"));
      await refreshAttendance();
    } catch (err) {
      setError(actionErrorText(err));
    } finally {
      setBusy(null);
    }
  }
  async function onAddCommitteeMembers() {
    if (!meeting.committeeId) return;
    setBusy("participants:committee");
    setError(null);
    setToast(null);
    try {
      // Fresh roster, not the held one: the add is asynchronous and the consumer rejects the WHOLE
      // batch if any employee is already on the meeting.
      const onRoster = new Set(await listParticipantEmployeeIds(meeting.id));
      const fresh = (await listCommitteeMembers(meeting.committeeId)).filter((m) => !onRoster.has(m.employeeId));
      if (fresh.length === 0) {
        setToast(tl("committeeAlreadyAdded"));
        return;
      }
      await addParticipants(
        meeting.id,
        fresh.map((m) => ({
          employeeId: m.employeeId,
          role: (PARTICIPANT_ROLES as readonly string[]).includes(m.role) ? (m.role as ParticipantRole) : "member",
        })),
      );
      setAwaitingIds(fresh.map((m) => m.employeeId));
      setToast(tl("participantsSubmitted"));
      await refreshAttendance();
    } catch (err) {
      setError(actionErrorText(err));
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
      setError(actionErrorText(err));
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
      setError(actionErrorText(err));
    } finally {
      setBusy(null);
    }
  }

  const transitions = nextTransitions(status);
  const blockers = status === "draft" && agendaSource === "api" ? scheduleBlockers(meeting, agenda.length) : [];

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
              <a
                href={meeting.vcLink}
                className="lnk"
                style={{ fontSize: 13 }}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Join video conference (opens in a new tab)"
              >
                Join VC ↗
              </a>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {/* GAP-MEETING-MEETINGS-MEETINGID-03: lifecycle buttons only for transition-authorised roles */}
            {viewerPermissions.canTransition &&
              transitions.map((t) => (
                <button
                  key={t.toState}
                  type="button"
                  className={t.danger ? "btn danger" : "btn primary"}
                  disabled={busy !== null || (t.toState === "scheduled" && blockers.length > 0)}
                  aria-describedby={t.toState === "scheduled" && blockers.length > 0 ? "mtg-schedule-blockers" : undefined}
                  onClick={() => {
                    if (t.danger) {
                      setTransitionErr(undefined);
                      setPendingTransition({ toState: t.toState, label: tl(`actions.${t.key}`), ...(t.needsReason ? { needsReason: true } : {}) });
                    } else {
                      void onTransition(t.toState);
                    }
                  }}
                >
                  {busy === `transition:${t.toState}` ? "…" : tl(`actions.${t.key}`)}
                </button>
              ))}
            <Link className="btn ghost" href={`/meeting/meetings/${meeting.id}/minutes`}>
              Minutes →
            </Link>
          </div>
        </div>
        {viewerPermissions.canTransition && blockers.length > 0 && (
          <ul id="mtg-schedule-blockers" style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 13, color: "var(--ink2)" }}>
            {blockers.map((b) => <li key={b}>{tl(`blockers.${b}`)}</li>)}
          </ul>
        )}
        {viewerPermissions.canTransition && (status === "draft" || status === "scheduled") && (
          <form onSubmit={(e) => void onAddAgenda(e)} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 12 }}>
            <div style={{ flex: "1 1 220px" }}>
              <label htmlFor="mtg-agenda-title" style={labelStyle}>{tl("agendaTitle")}</label>
              <input id="mtg-agenda-title" style={fieldStyle} value={agendaTitle} maxLength={500}
                onChange={(e) => setAgendaTitle(e.target.value)} />
            </div>
            <div>
              <label htmlFor="mtg-agenda-outcome" style={labelStyle}>{tl("agendaOutcome")}</label>
              <select id="mtg-agenda-outcome" style={fieldStyle} value={agendaOutcome}
                onChange={(e) => setAgendaOutcome(e.target.value as AgendaOutcomeType)}>
                {AGENDA_OUTCOME_TYPES.map((o) => <option key={o} value={o}>{tl(`outcome.${o}`)}</option>)}
              </select>
            </div>
            <button type="submit" className="btn" disabled={busy !== null || agendaTitle.trim() === ""}>
              {busy === "agenda:add" ? "…" : tl("addAgenda")}
            </button>
          </form>
        )}
      </Card>

      {/* GAP-MEETING-MEETINGS-MEETINGID-07: in-page anchor nav for narrow screens.
          At ≤375px a long single-column console is unreachable without scrolling;
          these skip-links let users jump directly to the section they need. */}
      <nav
        aria-label="Jump to section"
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          fontSize: 13,
          marginBottom: 4,
        }}
      >
        <a href="#section-stats" className="lnk" style={{ fontSize: 13 }}>Stats</a>
        <span aria-hidden="true" style={{ color: "var(--ink3)" }}>·</span>
        <a href="#section-agenda" className="lnk" style={{ fontSize: 13 }}>Agenda</a>
        <span aria-hidden="true" style={{ color: "var(--ink3)" }}>·</span>
        <a href="#section-attendance" className="lnk" style={{ fontSize: 13 }}>Attendance</a>
        <span aria-hidden="true" style={{ color: "var(--ink3)" }}>·</span>
        <a href="#section-voting" className="lnk" style={{ fontSize: 13 }}>Voting</a>
      </nav>

      <div id="section-stats"><StatGrid>
        <StatCard
          icon={meeting.quorumEstablished ? "✅" : "⚠️"}
          iconBg={meeting.quorumEstablished ? "var(--goodbg)" : "var(--warnbg)"}
          label="Quorum"
          value={meeting.quorumEstablished ? "Established" : "Not met"}
        />
        <StatCard
          icon="🟢"
          tone="info"
          label="Present (for quorum)"
          value={attState === "api" ? present.toLocaleString("en-IN") : "—"}
        />
        <StatCard
          icon="📋"
          tone="info"
          label="Agenda items"
          value={agendaSource === "api" ? agenda.length.toLocaleString("en-IN") : "—"}
        />
        <StatCard
          icon="🗳️"
          tone="neutral"
          label="Open votes"
          value={votesState === "api" ? votes.length.toLocaleString("en-IN") : "—"}
        />
      </StatGrid></div>

      {/* Voting panel */}
      <div id="section-voting"><Card
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
            message={'Use "Open a vote" below to start a motion. The live tally and result appear here.'}
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
                canCast={viewerPermissions.canCast}
                canConclude={viewerPermissions.canConclude}
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
      </Card></div>

      {/* Agenda */}
      <div id="section-agenda"><Card title={`Agenda (${agendaSource === "api" ? agenda.length : "—"})`} padding>
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
      </Card></div>

      {/* Attendance / quorum */}
      <div id="section-attendance"><Card
        title="Attendance & quorum"
        link={
          <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
            {status === "in_progress" && lastUpdated && (
              <span style={{ fontSize: 11.5, color: "var(--ink2)" }}>
                Updated {fmtTime(lastUpdated.toISOString())}
              </span>
            )}
            <button type="button" className="btn ghost sm" onClick={() => void refreshAttendance()}>
              Refresh
            </button>
          </span>
        }
        padding
      >
        {viewerPermissions.canManageParticipants && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
            {viewerPermissions.employeeDirectory !== "none" && (<>
            <div style={{ flex: "1 1 240px" }}>
              <div style={labelStyle}>{tl("participantEmployee")}</div>
              <EmployeePicker
                value={newParticipantId}
                onChange={(id) => setNewParticipantId(id)}
                aria-label={tl("participantEmployee")}
                directory={viewerPermissions.employeeDirectory ?? "hrms"}
                clearable
              />
            </div>
            <div>
              <label htmlFor="mtg-participant-role" style={labelStyle}>{tl("participantRole")}</label>
              <select id="mtg-participant-role" aria-label={tl("participantRole")} style={fieldStyle} value={newParticipantRole}
                onChange={(e) => setNewParticipantRole(e.target.value as ParticipantRole)}>
                {PARTICIPANT_ROLES.map((r) => <option key={r} value={r}>{humanize(r)}</option>)}
              </select>
            </div>
            <button type="button" className="btn" disabled={busy !== null || awaitingIds.length > 0 || !newParticipantId} onClick={() => void onAddParticipant()}>
              {busy === "participants:add" ? "…" : tl("addParticipant")}
            </button>
            </>)}
            {meeting.committeeId && (
              <button type="button" className="btn ghost" disabled={busy !== null || awaitingIds.length > 0} onClick={() => void onAddCommitteeMembers()}>
                {busy === "participants:committee" ? "…" : tl("addCommitteeMembers")}
              </button>
            )}
          </div>
        )}
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
                    <th style={labelStyle}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {attendance.participants.map((p) => {
                    const inRoom = p.status === "present" || p.status === "joined_late";
                    return (
                      <tr key={p.participantId}>
                        <td>
                          {(() => {
                            // UX-R5: a name and designation, never a raw participant / employee UUID.
                            const ref = p.employeeId ? people[p.employeeId] : undefined;
                            const name = p.displayName || ref?.name || null;
                            const designation = p.designation || ref?.designation || null;
                            const empNo = p.employeeId && !isUuid(p.employeeId) ? p.employeeId : null;
                            const sub = [designation, empNo].filter(Boolean).join(" · ");
                            return name ? (
                              <>
                                <div style={{ fontWeight: 600 }}>{name}</div>
                                {sub ? <div style={{ fontSize: 12, color: "var(--ink2)" }}>{sub}</div> : null}
                              </>
                            ) : (
                              <div style={{ fontWeight: 600, fontSize: 12.5 }}>
                                {empNo ?? unresolvedLabel(p.employeeId || p.participantId)}
                              </div>
                            );
                          })()}
                          {p.isMandatory && (
                            <span style={{ fontSize: 11, color: "var(--warn)" }}>Mandatory</span>
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
                          {/* GAP-MEETING-MEETINGS-MEETINGID-03: check-in/out for authorised roles only */}
                          {viewerPermissions.canCheckIn && (inRoom ? (
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
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card></div>

      <ConfirmDialog
        open={pendingTransition !== null}
        title={`${pendingTransition?.label ?? "Change meeting state"}?`}
        description={pendingTransition ? transitionConsequence(pendingTransition.toState) : undefined}
        confirmLabel={pendingTransition?.label}
        danger
        requireReason={pendingTransition?.needsReason === true}
        reasonLabel={tl("adjournReason")}
        maxReasonLength={2000}
        busy={busy !== null}
        errorMessage={transitionErr}
        onConfirm={(reason) => void onConfirmTransition(reason)}
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
  setToast,
  onChanged,
  myPosition,
  onVoted,
  canCast,
  canConclude,
}: PanelCtl & {
  meetingId: string;
  vote: ActiveVote;
  onChanged: () => Promise<void>;
  /** This browser's own recorded position for this resolution, if any (Req 7). */
  myPosition?: VotePosition;
  onVoted: (position: VotePosition) => void;
  /** GAP-MEETING-MEETINGS-MEETINGID-03: session permissions. */
  canCast: boolean;
  canConclude: boolean;
}) {
  const secret = vote.voteType === "secret_ballot";
  // Cast is gated behind a confirmation: a ballot can't be changed once cast
  // (see the dialog copy below), so it needs the same protect-from-mistakes
  // treatment as MinutesPanel's approve/reject actions.
  const [confirmPosition, setConfirmPosition] = useState<VotePosition | null>(null);
  const [castErr, setCastErr] = useState<string | undefined>(undefined);
  // GAP-MEETING-MEETINGS-MEETINGID-01: concluding closes voting and computes
  // the result — ballots can't be added afterwards and there is no reopen — so
  // it must be confirmed, like cast/adjourn, not fire on a single click.
  const [concludeConfirm, setConcludeConfirm] = useState(false);
  const [concludeErr, setConcludeErr] = useState<string | undefined>(undefined);

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
      setCastErr(actionErrorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function conclude() {
    setBusy(`conclude:${vote.resolutionId}`);
    setConcludeErr(undefined);
    setToast(null);
    try {
      await concludeVote(meetingId, vote.resolutionId);
      setToast("Vote concluded — result computed.");
      setConcludeConfirm(false);
      await onChanged();
    } catch (err) {
      setConcludeErr(actionErrorText(err));
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
              color: "var(--good)",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            ✓ You voted: {humanize(myPosition)}
          </span>
        ) : canCast ? (
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
        ) : null}
        {/* GAP-MEETING-MEETINGS-MEETINGID-03: conclude only for authorised roles */}
        {canConclude && (
          <button
            type="button"
            className="btn primary sm"
            disabled={busy !== null}
            onClick={() => {
              setConcludeErr(undefined);
              setConcludeConfirm(true);
            }}
            style={{ marginLeft: "auto" }}
          >
            {busy === `conclude:${vote.resolutionId}` ? "…" : "Conclude vote"}
          </button>
        )}
      </div>
      {secret && (
        <p style={{ fontSize: 12, color: "var(--ink2)", marginTop: 8 }}>
          Secret ballot — individual positions are withheld; only the aggregate tally is shown.
        </p>
      )}

      <ConfirmDialog
        open={concludeConfirm}
        title="Conclude this vote?"
        description={`Closes voting and computes the result per the ${humanize(vote.majorityRule)} rule. Ballots can't be added afterwards and the vote can't be reopened. Current tally — For ${vote.tally.votesFor}, Against ${vote.tally.votesAgainst}, Abstain ${vote.tally.votesAbstain} (total ${vote.tally.total}).`}
        confirmLabel="Conclude vote"
        danger
        busy={busy !== null}
        errorMessage={concludeErr}
        onConfirm={() => void conclude()}
        onCancel={() => {
          if (busy === null) setConcludeConfirm(false);
        }}
      />

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
      setError(actionErrorText(err));
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
