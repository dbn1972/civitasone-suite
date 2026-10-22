"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AcceptedNotice } from "../../../../_components/ds";

/**
 * GAP-HR-TRAINING-NEW-01: shown on /hr/training when the new-programme form
 * handed over `?created=<id>` but that programme is not in the list yet
 * (POST /v1/hrms/trainings is a 202 -- the consumer inserts the row
 * asynchronously). It says only what is true -- the submission was received
 * and is still being applied -- and gives a real Refresh, never a fake
 * "created" and never a timer.
 */
export function PendingProgramNotice() {
  const t = useTranslations("training");
  const router = useRouter();
  const [refreshed, setRefreshed] = useState(false);
  return (
    <AcceptedNotice
      phase="accepted"
      message={t("pendingProgramMessage")}
      refreshed={refreshed}
      onRefresh={() => {
        router.refresh();
        setRefreshed(true);
      }}
    />
  );
}
