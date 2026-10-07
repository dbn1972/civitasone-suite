"use client";

import { Button } from "@/app/_components/ds";

interface MeetingActionsProps {
  meetingId: string;
}

export function MeetingActions({ meetingId: _meetingId }: MeetingActionsProps) {
  return (
    <>
      {/*
        GAP-ESTAB-MEETINGS-DETAIL-05: removed the header "Agenda" link — it
        duplicated the Agenda tab below. Only one route to the agenda now.

        There is no /generate-mom route (and no backend endpoint this page
        knows of) — the button used to silently no-op via a client-side
        redirect to a 404. Disabled honestly until MOM generation is built,
        rather than left as a dead link. MOM is still capturable today via
        the "MOM" field/Action items shown below once a meeting completes.
      */}
      <Button
        type="button"
        style={{ minHeight: 44 }}
        disabled
        aria-disabled="true"
        title="Generating MOM automatically is coming soon."
      >
        Generate MOM{" "}
        <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.85 }}>(coming soon)</span>
      </Button>
    </>
  );
}
