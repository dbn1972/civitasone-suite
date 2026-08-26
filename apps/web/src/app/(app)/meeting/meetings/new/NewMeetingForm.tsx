"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/app/_components/ds";
import {
  CONFIDENTIALITY_LEVELS,
  MEETING_TYPES,
  type CommitteeSummary,
  type ConfidentialityLevel,
  type CreateMeetingInput,
  type MeetingType,
} from "../../_data/types";
import { createMeeting, listCommittees } from "../../_data/client";
import { humanize } from "../../_data/format";

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 4,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".13em",
  textTransform: "uppercase",
  color: "var(--ink2)",
};

const helpStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--ink2)",
  marginTop: 4,
};

const errStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--bad)",
  marginTop: 4,
};

function fieldStyle(invalid: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: 10,
    borderRadius: 8,
    border: `1px solid ${invalid ? "var(--bad)" : "var(--line)"}`,
    fontSize: 13.5,
    fontFamily: "inherit",
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Same optimistic-write convention as MinutesPanel.tsx (REFRESH_DELAY_MS):
// the create is queued (202) and the read model catches up a beat later, so
// pause briefly before navigating to the new meeting's console.
const NAVIGATE_DELAY_MS = 900;

interface FormState {
  title: string;
  type: MeetingType;
  scheduledAt: string; // datetime-local value, e.g. "2026-09-01T10:00"
  durationMinutes: string;
  committeeId: string;
  chairpersonId: string;
  secretaryId: string;
  convenerId: string;
  venue: string;
  vcEnabled: boolean;
  confidentialityLevel: ConfidentialityLevel | "";
  description: string;
}

const INITIAL: FormState = {
  title: "",
  type: "committee",
  scheduledAt: "",
  durationMinutes: "60",
  committeeId: "",
  chairpersonId: "",
  secretaryId: "",
  convenerId: "",
  venue: "",
  vcEnabled: false,
  confidentialityLevel: "",
  description: "",
};

type Errors = Partial<Record<keyof FormState, string>>;

/** Validates against createMeetingSchema (meeting-core/validators.ts) bounds. */
function validate(f: FormState): Errors {
  const errors: Errors = {};

  const title = f.title.trim();
  if (!title) errors.title = "Enter a title.";
  else if (title.length > 500) errors.title = "Keep the title under 500 characters.";

  if (!f.scheduledAt) {
    errors.scheduledAt = "Pick a date and time.";
  } else {
    const d = new Date(f.scheduledAt);
    if (Number.isNaN(d.getTime())) errors.scheduledAt = "Enter a valid date and time.";
  }

  const duration = Number(f.durationMinutes);
  if (f.durationMinutes.trim() === "" || !Number.isFinite(duration)) {
    errors.durationMinutes = "Enter the duration in minutes.";
  } else if (!Number.isInteger(duration) || duration <= 0) {
    errors.durationMinutes = "Duration must be a whole number of minutes greater than 0.";
  } else if (duration > 24 * 60) {
    errors.durationMinutes = "Duration can't exceed 1440 minutes (24 hours).";
  }

  if (!f.chairpersonId.trim()) {
    errors.chairpersonId = "Enter the chairperson's user ID.";
  } else if (!UUID_RE.test(f.chairpersonId.trim())) {
    errors.chairpersonId = "Enter a valid user ID (UUID format).";
  }

  if (!f.secretaryId.trim()) {
    errors.secretaryId = "Enter the secretary's user ID.";
  } else if (!UUID_RE.test(f.secretaryId.trim())) {
    errors.secretaryId = "Enter a valid user ID (UUID format).";
  }

  if (f.convenerId.trim() && !UUID_RE.test(f.convenerId.trim())) {
    errors.convenerId = "Enter a valid user ID (UUID format), or leave this blank.";
  }

  if (f.venue.trim().length > 1000) errors.venue = "Keep the venue under 1000 characters.";
  if (f.description.trim().length > 20_000) {
    errors.description = "Keep the description under 20,000 characters.";
  }

  return errors;
}

export function NewMeetingForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [errors, setErrors] = useState<Errors>({});
  const [committees, setCommittees] = useState<CommitteeSummary[]>([]);
  const [committeesFailed, setCommitteesFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listCommittees()
      .then((rows) => {
        if (!cancelled) setCommittees(rows);
      })
      .catch(() => {
        if (!cancelled) setCommitteesFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nextErrors = validate(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setSubmitError("Fix the highlighted fields and try again.");
      return;
    }

    setBusy(true);
    setSubmitError(null);
    try {
      const input: CreateMeetingInput = {
        title: form.title.trim(),
        type: form.type,
        scheduledAt: new Date(form.scheduledAt).toISOString(),
        durationMinutes: Number(form.durationMinutes),
        chairpersonId: form.chairpersonId.trim(),
        secretaryId: form.secretaryId.trim(),
        ...(form.committeeId ? { committeeId: form.committeeId } : {}),
        ...(form.convenerId.trim() ? { convenerId: form.convenerId.trim() } : {}),
        ...(form.venue.trim() ? { venue: form.venue.trim() } : {}),
        ...(form.vcEnabled ? { vcEnabled: true } : {}),
        ...(form.confidentialityLevel ? { confidentialityLevel: form.confidentialityLevel } : {}),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
      };
      const { id } = await createMeeting(input);
      setCreated(true);
      if (id) {
        await new Promise((r) => setTimeout(r, NAVIGATE_DELAY_MS));
        router.push(`/meeting/meetings/${id}`);
      } else {
        // Accepted but no id came back (shouldn't happen per the contract,
        // but don't strand the user on a form that looks like it did
        // nothing) — send them to the list instead of guessing a URL.
        await new Promise((r) => setTimeout(r, NAVIGATE_DELAY_MS));
        router.push("/meeting/meetings");
      }
    } catch (err) {
      setCreated(false);
      setSubmitError(err instanceof Error ? err.message : "Could not schedule the meeting.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {created && (
        <div className="alert" role="status" style={{ borderColor: "var(--primary)" }}>
          ✓ Meeting scheduled — opening it now…
        </div>
      )}
      {submitError && (
        <div className="alert" role="alert" style={{ borderColor: "#fca5a5", color: "var(--bad)" }}>
          ⚠ {submitError}
        </div>
      )}

      <Card title="Meeting details" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div>
            <label htmlFor="nm-title" style={labelStyle}>
              Title
            </label>
            <input
              id="nm-title"
              type="text"
              value={form.title}
              maxLength={500}
              onChange={(e) => set("title", e.target.value)}
              style={fieldStyle(Boolean(errors.title))}
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? "nm-title-err" : undefined}
            />
            {errors.title && (
              <div id="nm-title-err" style={errStyle}>
                {errors.title}
              </div>
            )}
          </div>

          <div
            style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}
          >
            <div>
              <label htmlFor="nm-type" style={labelStyle}>
                Meeting type
              </label>
              <select
                id="nm-type"
                value={form.type}
                onChange={(e) => set("type", e.target.value as MeetingType)}
                style={fieldStyle(false)}
              >
                {MEETING_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {humanize(t)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="nm-when" style={labelStyle}>
                Scheduled date &amp; time
              </label>
              <input
                id="nm-when"
                type="datetime-local"
                value={form.scheduledAt}
                onChange={(e) => set("scheduledAt", e.target.value)}
                style={fieldStyle(Boolean(errors.scheduledAt))}
                aria-invalid={Boolean(errors.scheduledAt)}
                aria-describedby={errors.scheduledAt ? "nm-when-err" : undefined}
              />
              {errors.scheduledAt && (
                <div id="nm-when-err" style={errStyle}>
                  {errors.scheduledAt}
                </div>
              )}
            </div>

            <div>
              <label htmlFor="nm-duration" style={labelStyle}>
                Duration (minutes)
              </label>
              <input
                id="nm-duration"
                type="number"
                min={1}
                max={1440}
                value={form.durationMinutes}
                onChange={(e) => set("durationMinutes", e.target.value)}
                style={fieldStyle(Boolean(errors.durationMinutes))}
                aria-invalid={Boolean(errors.durationMinutes)}
                aria-describedby={errors.durationMinutes ? "nm-duration-err" : undefined}
              />
              {errors.durationMinutes ? (
                <div id="nm-duration-err" style={errStyle}>
                  {errors.durationMinutes}
                </div>
              ) : (
                <div style={helpStyle}>1–1440 minutes (up to 24 hours).</div>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="nm-committee" style={labelStyle}>
              Committee (optional)
            </label>
            <select
              id="nm-committee"
              value={form.committeeId}
              onChange={(e) => set("committeeId", e.target.value)}
              style={fieldStyle(false)}
              disabled={committeesFailed}
            >
              <option value="">— none —</option>
              {committees.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {committeesFailed && (
              <div style={helpStyle}>
                Couldn't load the committee list — you can still schedule without one.
              </div>
            )}
          </div>

          <div
            style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}
          >
            <div>
              <label htmlFor="nm-chair" style={labelStyle}>
                Chairperson user ID
              </label>
              <input
                id="nm-chair"
                type="text"
                value={form.chairpersonId}
                placeholder="00000000-0000-0000-0000-000000000000"
                onChange={(e) => set("chairpersonId", e.target.value)}
                style={{ ...fieldStyle(Boolean(errors.chairpersonId)), fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
                aria-invalid={Boolean(errors.chairpersonId)}
                aria-describedby={errors.chairpersonId ? "nm-chair-err" : "nm-chair-help"}
              />
              {errors.chairpersonId ? (
                <div id="nm-chair-err" style={errStyle}>
                  {errors.chairpersonId}
                </div>
              ) : (
                <div id="nm-chair-help" style={helpStyle}>
                  The user who will chair this meeting.
                </div>
              )}
            </div>

            <div>
              <label htmlFor="nm-secretary" style={labelStyle}>
                Secretary user ID
              </label>
              <input
                id="nm-secretary"
                type="text"
                value={form.secretaryId}
                placeholder="00000000-0000-0000-0000-000000000000"
                onChange={(e) => set("secretaryId", e.target.value)}
                style={{ ...fieldStyle(Boolean(errors.secretaryId)), fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
                aria-invalid={Boolean(errors.secretaryId)}
                aria-describedby={errors.secretaryId ? "nm-secretary-err" : "nm-secretary-help"}
              />
              {errors.secretaryId ? (
                <div id="nm-secretary-err" style={errStyle}>
                  {errors.secretaryId}
                </div>
              ) : (
                <div id="nm-secretary-help" style={helpStyle}>
                  Drafts the minutes after the meeting.
                </div>
              )}
            </div>

            <div>
              <label htmlFor="nm-convener" style={labelStyle}>
                Convener user ID (optional)
              </label>
              <input
                id="nm-convener"
                type="text"
                value={form.convenerId}
                placeholder="00000000-0000-0000-0000-000000000000"
                onChange={(e) => set("convenerId", e.target.value)}
                style={{ ...fieldStyle(Boolean(errors.convenerId)), fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
                aria-invalid={Boolean(errors.convenerId)}
                aria-describedby={errors.convenerId ? "nm-convener-err" : undefined}
              />
              {errors.convenerId && (
                <div id="nm-convener-err" style={errStyle}>
                  {errors.convenerId}
                </div>
              )}
            </div>
          </div>

          <div
            style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}
          >
            <div>
              <label htmlFor="nm-venue" style={labelStyle}>
                Venue (optional)
              </label>
              <input
                id="nm-venue"
                type="text"
                value={form.venue}
                maxLength={1000}
                onChange={(e) => set("venue", e.target.value)}
                style={fieldStyle(Boolean(errors.venue))}
              />
              {errors.venue && <div style={errStyle}>{errors.venue}</div>}
            </div>

            <div>
              <label htmlFor="nm-confidentiality" style={labelStyle}>
                Confidentiality (optional)
              </label>
              <select
                id="nm-confidentiality"
                value={form.confidentialityLevel}
                onChange={(e) => set("confidentialityLevel", e.target.value as ConfidentialityLevel | "")}
                style={fieldStyle(false)}
              >
                <option value="">— default (internal) —</option>
                {CONFIDENTIALITY_LEVELS.map((c) => (
                  <option key={c} value={c}>
                    {humanize(c)}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
                <input
                  type="checkbox"
                  checked={form.vcEnabled}
                  onChange={(e) => set("vcEnabled", e.target.checked)}
                />
                Video conferencing enabled
              </label>
            </div>
          </div>

          <div>
            <label htmlFor="nm-description" style={labelStyle}>
              Description (optional)
            </label>
            <textarea
              id="nm-description"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              rows={3}
              style={fieldStyle(Boolean(errors.description))}
            />
            {errors.description && <div style={errStyle}>{errors.description}</div>}
          </div>
        </div>
      </Card>

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "Scheduling…" : "Schedule meeting"}
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={busy}
          onClick={() => router.push("/meeting/meetings")}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
