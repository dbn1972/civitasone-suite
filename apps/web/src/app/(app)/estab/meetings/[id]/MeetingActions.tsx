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
      <button
        type="button"
        className="btn primary"
        style={{ minHeight: 44 }}
        onClick={() => {
          window.location.href = `/estab/meetings/${meetingId}/generate-mom`;
        }}
      >
        Generate MOM
      </button>
    </>
  );
}
