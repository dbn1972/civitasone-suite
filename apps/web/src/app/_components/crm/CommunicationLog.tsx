"use client";
/**
 * CommunicationLog — AC-003. A "Log communication" form (direction, channel,
 * outcome, disposition, when it happened, summary) plus a chronological
 * communications timeline for the record. Save is blocked until a summary is
 * entered; a failed load shows the saved-info badge rather than an empty log.
 */
import { useEffect, useId, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { EmptyState } from "../ds";
import {
  getCommunications,
  createCommunication,
  COMM_DIRECTIONS,
  COMM_DIRECTION_LABELS,
  COMM_CHANNELS,
  COMM_CHANNEL_LABELS,
  type CommDirection,
  type CommChannel,
  type CommunicationEntry,
  type SubjectType,
  type AaSource,
} from "@/lib/crm/activityAccount";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

function fmtDateTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Local datetime string for the default "now" value of the datetime-local input. */
function nowLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Props {
  subjectType: SubjectType;
  subjectId: string;
}

export function CommunicationLog({ subjectType, subjectId }: Props) {
  const [items, setItems] = useState<CommunicationEntry[]>([]);
  const [source, setSource] = useState<AaSource | "loading">("loading");
  const [direction, setDirection] = useState<CommDirection>("outbound");
  const [channel, setChannel] = useState<CommChannel>("phone");
  const [outcome, setOutcome] = useState("");
  const [disposition, setDisposition] = useState("");
  const [occurredAt, setOccurredAt] = useState(nowLocal());
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const headingId = useId();

  async function load(isLive: () => boolean = () => true) {
    setSource("loading");
    const { data, source: s } = await getCommunications(subjectType, subjectId);
    if (!isLive()) return;
    setItems(data);
    setSource(s);
  }

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => {
      live = false;
    };
  }, [subjectType, subjectId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    if (summary.trim().length === 0) {
      setError("Enter a short summary of the communication.");
      return;
    }
    const when = new Date(occurredAt);
    const occurredIso = Number.isNaN(when.getTime()) ? new Date().toISOString() : when.toISOString();
    setBusy(true);
    try {
      const { accepted } = await createCommunication({
        subjectType,
        subjectId,
        direction,
        channel,
        occurredAt: occurredIso,
        summary: summary.trim(),
        ...(outcome.trim() ? { outcome: outcome.trim() } : {}),
        ...(disposition.trim() ? { disposition: disposition.trim() } : {}),
      });
      setMessage(accepted ? "Communication logged — it may take a moment to appear." : "Communication logged.");
      setOutcome("");
      setDisposition("");
      setSummary("");
      setOccurredAt(nowLocal());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not log the communication.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Communications</h3>
        {source === "error" ? <DataSourceBadge source="error" /> : null}
      </div>
      <div className="pad" style={{ display: "grid", gap: 16 }}>
        <form onSubmit={submit} aria-labelledby={headingId} style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label htmlFor={`${headingId}-dir`} style={labelStyle}>Direction</label>
              <select id={`${headingId}-dir`} value={direction} onChange={(e) => setDirection(e.target.value as CommDirection)} style={inputStyle}>
                {COMM_DIRECTIONS.map((d) => <option key={d} value={d}>{COMM_DIRECTION_LABELS[d]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={`${headingId}-chan`} style={labelStyle}>Channel</label>
              <select id={`${headingId}-chan`} value={channel} onChange={(e) => setChannel(e.target.value as CommChannel)} style={inputStyle}>
                {COMM_CHANNELS.map((c) => <option key={c} value={c}>{COMM_CHANNEL_LABELS[c]}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label htmlFor={`${headingId}-outcome`} style={labelStyle}>Outcome</label>
              <input id={`${headingId}-outcome`} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="e.g. Connected" style={inputStyle} />
            </div>
            <div>
              <label htmlFor={`${headingId}-disp`} style={labelStyle}>Disposition</label>
              <input id={`${headingId}-disp`} value={disposition} onChange={(e) => setDisposition(e.target.value)} placeholder="e.g. Follow-up needed" style={inputStyle} />
            </div>
          </div>
          <div>
            <label htmlFor={`${headingId}-when`} style={labelStyle}>When</label>
            <input id={`${headingId}-when`} type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label htmlFor={`${headingId}-summary`} style={labelStyle}>Summary</label>
            <textarea
              id={`${headingId}-summary`}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="What was discussed?"
              rows={3}
              aria-required="true"
              aria-invalid={summary.trim() ? undefined : true}
              style={{ ...inputStyle, minHeight: undefined }}
            />
          </div>
          <div>
            <button type="submit" className="btn primary" disabled={busy} style={{ minHeight: 44 }}>
              {busy ? "Saving…" : "Log communication"}
            </button>
          </div>
          {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", margin: 0 }}>{message}</p> : null}
          {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", margin: 0 }}>{error}</p> : null}
        </form>

        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          {source === "loading" ? (
            <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Loading communications…</p>
          ) : source === "error" ? (
            <p role="alert" style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
              — Communications unavailable right now. <DataSourceBadge source="error" />
            </p>
          ) : items.length === 0 ? (
            <EmptyState icon="💬" title="No communications yet" message="Log the first call, email or message above." />
          ) : (
            <ul className="tl" aria-label="Communications timeline">
              {items.map((c) => (
                <li key={c.id} className="cur">
                  <div className="t">
                    <span className="pill info" style={{ marginRight: 6 }}>
                      {COMM_DIRECTION_LABELS[c.direction as CommDirection] ?? c.direction} · {COMM_CHANNEL_LABELS[c.channel as CommChannel] ?? c.channel}
                    </span>
                    {c.summary}
                  </div>
                  <div className="d" style={{ fontSize: 12, color: "var(--muted)" }}>
                    {c.outcome ? <>{c.outcome} · </> : null}
                    {c.disposition ? <>{c.disposition} · </> : null}
                    {fmtDateTime(c.occurredAt)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
