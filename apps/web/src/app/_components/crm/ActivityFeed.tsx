"use client";
/**
 * ActivityFeed — AC-001. A typed activity composer (task / call / meeting /
 * appointment / note / reminder) with type-aware fields — due-at for anything
 * scheduled, remind-at for reminders, location for meetings & appointments —
 * plus a chronological activity timeline for the record. Save is blocked until
 * a note is entered; on a failed load we show the saved-info badge and never
 * fabricate an empty timeline as fact. Reloads after a successful compose.
 */
import { useEffect, useId, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { EmptyState } from "../ds";
import { formatIndianDate } from "@/lib/formatters";
import {
  getActivities,
  createActivity,
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABELS,
  ACTIVITY_TYPES_WITH_LOCATION,
  ACTIVITY_TYPES_WITH_REMIND,
  ACTIVITY_TYPES_WITH_DUE,
  type ActivityType,
  type ActivityEntry,
  type SubjectType,
  type AaSource,
} from "@/lib/crm/activityAccount";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

function fmtDateTime(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** datetime-local value ("2026-08-04T09:30") → ISO, or undefined when blank. */
function toIso(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

interface Props {
  subjectType: SubjectType;
  subjectId: string;
}

export function ActivityFeed({ subjectType, subjectId }: Props) {
  const [items, setItems] = useState<ActivityEntry[]>([]);
  const [source, setSource] = useState<AaSource | "loading">("loading");
  const [type, setType] = useState<ActivityType>("task");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [remindAt, setRemindAt] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const headingId = useId();

  async function load(isLive: () => boolean = () => true) {
    setSource("loading");
    const { data, source: s } = await getActivities(subjectType, subjectId);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectType, subjectId]);

  const showDue = ACTIVITY_TYPES_WITH_DUE.includes(type);
  const showRemind = ACTIVITY_TYPES_WITH_REMIND.includes(type);
  const showLocation = ACTIVITY_TYPES_WITH_LOCATION.includes(type);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    if (text.trim().length === 0) {
      setError("Enter a note describing the activity.");
      return;
    }
    setBusy(true);
    try {
      const { accepted } = await createActivity({
        type,
        subjectType,
        subjectId,
        text: text.trim(),
        ...(subject.trim() ? { subject: subject.trim() } : {}),
        ...(showDue ? { dueAt: toIso(dueAt) } : {}),
        ...(showRemind ? { remindAt: toIso(remindAt) } : {}),
        ...(showLocation && location.trim() ? { location: location.trim() } : {}),
      });
      setMessage(accepted ? "Activity logged — it may take a moment to appear." : "Activity logged.");
      setSubject("");
      setText("");
      setDueAt("");
      setRemindAt("");
      setLocation("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not log the activity.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Activity &amp; follow-up</h3>
        {source === "error" ? <DataSourceBadge source="error" /> : null}
      </div>
      <div className="pad" style={{ display: "grid", gap: 16 }}>
        <form onSubmit={submit} aria-labelledby={headingId} style={{ display: "grid", gap: 10 }}>
          <div>
            <label htmlFor={`${headingId}-type`} style={labelStyle}>Type</label>
            <select
              id={`${headingId}-type`}
              value={type}
              onChange={(e) => setType(e.target.value as ActivityType)}
              style={inputStyle}
            >
              {ACTIVITY_TYPES.map((t) => (
                <option key={t} value={t}>{ACTIVITY_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${headingId}-subject`} style={labelStyle}>Subject</label>
            <input
              id={`${headingId}-subject`}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Short summary"
              style={inputStyle}
            />
          </div>
          {showDue ? (
            <div>
              <label htmlFor={`${headingId}-due`} style={labelStyle}>
                {type === "reminder" ? "Scheduled for" : "Due"}
              </label>
              <input
                id={`${headingId}-due`}
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                style={inputStyle}
              />
            </div>
          ) : null}
          {showRemind ? (
            <div>
              <label htmlFor={`${headingId}-remind`} style={labelStyle}>Remind at</label>
              <input
                id={`${headingId}-remind`}
                type="datetime-local"
                value={remindAt}
                onChange={(e) => setRemindAt(e.target.value)}
                style={inputStyle}
              />
            </div>
          ) : null}
          {showLocation ? (
            <div>
              <label htmlFor={`${headingId}-location`} style={labelStyle}>Location</label>
              <input
                id={`${headingId}-location`}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Where is it happening?"
                style={inputStyle}
              />
            </div>
          ) : null}
          <div>
            <label htmlFor={`${headingId}-notes`} style={labelStyle}>Notes</label>
            <textarea
              id={`${headingId}-notes`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What happened or needs doing?"
              rows={3}
              aria-required="true"
              aria-invalid={text.trim() ? undefined : true}
              style={{ ...inputStyle, minHeight: undefined }}
            />
          </div>
          <div>
            <button type="submit" className="btn primary" disabled={busy} style={{ minHeight: 44 }}>
              {busy ? "Saving…" : "Log activity"}
            </button>
          </div>
          {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", margin: 0 }}>{message}</p> : null}
          {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", margin: 0 }}>{error}</p> : null}
        </form>

        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          {source === "loading" ? (
            <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Loading timeline…</p>
          ) : source === "error" ? (
            <p role="alert" style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
              — Timeline unavailable right now. <DataSourceBadge source="error" />
            </p>
          ) : items.length === 0 ? (
            <EmptyState icon="📋" title="No activity yet" message="Log the first call, meeting, task or note above." />
          ) : (
            <ul className="tl" aria-label="Activity timeline">
              {items.map((a) => (
                <li key={a.id} className={a.status === "completed" ? "done" : "cur"}>
                  <div className="t">
                    <span className="pill info" style={{ marginRight: 6 }}>
                      {ACTIVITY_TYPE_LABELS[a.type as ActivityType] ?? a.type}
                    </span>
                    {a.subject || a.text.slice(0, 80) || "Activity"}
                  </div>
                  {a.text && a.subject ? <div className="d" style={{ color: "var(--muted)" }}>{a.text}</div> : null}
                  <div className="d" style={{ fontSize: 12, color: "var(--muted)" }}>
                    {a.dueAt ? <>Due {fmtDateTime(a.dueAt)} · </> : null}
                    {a.location ? <>{a.location} · </> : null}
                    {a.createdAt ? <>Logged {formatIndianDate(a.createdAt)}</> : null}
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
