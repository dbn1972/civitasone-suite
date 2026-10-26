"use client";

import Link from "next/link";
import { useEstabT } from "@/lib/estab/useEstabT";

interface MeetingActionsProps {
  meetingId: string;
}

export function MeetingActions({ meetingId: _meetingId }: MeetingActionsProps) {
  const t = useEstabT();
  return (
    <>
      {/*
        GAP-ESTAB-MEETINGS-DETAIL-05: the header "Agenda" link was removed; it duplicated the
        Agenda tab, which is the single route to the agenda.

        GAP-ESTAB-MEETINGS-DETAIL-04 (owner decision #30): the dead, disabled "Generate MOM" button is
        gone. The MOM is produced through meeting-service's minutes workflow and linked from this
        meeting, so the header action jumps to the Minutes (MOM) section where that link is managed.
      */}
      <Link className="btn" style={{ minHeight: 44 }} href="#mom">
        {t("momLink")}
      </Link>
    </>
  );
}
