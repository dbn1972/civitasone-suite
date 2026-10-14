"use client";

import { Button } from "@/app/_components/ds";
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

        GAP-ESTAB-MEETINGS-DETAIL-04 (NEEDS OWNER DECISION): this screen cannot capture or generate
        minutes. There is no generate-MOM endpoint, and no MOM field on this page; minutes are only
        shown when the meeting service already holds them. The control stays disabled and says so,
        instead of promising a feature or pointing at a field that does not exist.
      */}
      <Button
        type="button"
        style={{ minHeight: 44 }}
        disabled
        aria-disabled="true"
        title={t("momUnavailableTitle")}
      >
        {t("momGenerate")}
      </Button>
    </>
  );
}
