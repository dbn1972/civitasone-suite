"use client";

import Link from "next/link";

interface MeetingActionsProps {
  meetingId: string;
}

export function MeetingActions({ meetingId }: MeetingActionsProps) {
  return (
    <>
      <Link
        href={`/estab/meetings/${meetingId}?tab=agenda`}
        className="btn ghost"
        style={{ minHeight: 44 }}
      >
        Agenda
      </Link>
      {/*
        There is no /generate-mom route (and no backend endpoint this page
        knows of) — the button used to silently no-op via a client-side
        redirect to a 404. Disabled honestly until MOM generation is built,
        rather than left as a dead link. MOM is still capturable today via
        the "MOM" field/Action items shown below once a meeting completes.
      */}
      <button
        type="button"
        className="btn primary"
        style={{ minHeight: 44 }}
        disabled
        aria-disabled="true"
        title="Generating MOM automatically is coming soon."
      >
        Generate MOM{" "}
        <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.85 }}>(coming soon)</span>
      </button>
    </>
  );
}
