"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { useEstabT } from "@/lib/estab/useEstabT";
import { Alert, Button, Select, StatusPill } from "@/app/_components/ds";
import { browserFetch } from "@/lib/api/browserClient";
import { formatIndianDate } from "@/lib/formatters";
import { createMinutes, fetchMinutes } from "../../../meeting/_data/client";
import type { Minutes } from "../../../meeting/_data/types";

/**
 * GAP-ESTAB-MEETINGS-DETAIL-04 (owner decision #30): the MOM of an estab meeting is produced through
 * meeting-service's existing minutes workflow (draft -> approve) and LINKED from the estab meeting. This
 * panel never edits minutes text itself: it links the meeting, starts the draft there, shows the live
 * state, and routes into the workflow where the maker (secretary) and checker (chairperson) act.
 */
export function MeetingMinutesPanel({
  estabMeetingId,
  governanceMeetingId,
}: {
  estabMeetingId: string;
  governanceMeetingId: string | null;
}) {
  const t = useEstabT("estabMeetingMom");
  return (
    <div className="card" id="mom">
      <div className="card-h"><h3>{t("heading")}</h3></div>
      <div className="pad">
        {governanceMeetingId ? (
          <LinkedMinutes governanceMeetingId={governanceMeetingId} />
        ) : (
          <LinkPicker estabMeetingId={estabMeetingId} />
        )}
      </div>
    </div>
  );
}

type MeetingOption = { id: string; title: string; scheduledAt: string | null };

function LinkPicker({ estabMeetingId }: { estabMeetingId: string }) {
  const t = useEstabT("estabMeetingMom");
  const router = useRouter();
  const selectId = useId();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<MeetingOption[] | null>(null);
  const [listError, setListError] = useState(false);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [linkError, setLinkError] = useState(false);

  async function loadOptions() {
    setOpen(true);
    setListError(false);
    setOptions(null);
    try {
      const res = await browserFetch("v1/meeting?limit=100");
      if (!res.ok) throw new Error("list");
      const body = (await res.json()) as { data?: Array<Record<string, unknown>> };
      const rows = Array.isArray(body.data) ? body.data : [];
      setOptions(
        rows
          .filter((r) => typeof r.id === "string" && typeof r.title === "string")
          .map((r) => ({
            id: r.id as string,
            title: r.title as string,
            scheduledAt: typeof r.scheduledAt === "string" ? r.scheduledAt : null,
          })),
      );
    } catch {
      setListError(true);
    }
  }

  async function link() {
    if (!choice) return;
    setBusy(true);
    setLinkError(false);
    try {
      const res = await browserFetch(`v1/estab/meetings/${estabMeetingId}/governance-link`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ governanceMeetingId: choice }),
      });
      if (!res.ok) throw new Error("link");
      router.refresh();
    } catch {
      setLinkError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <p className="sub" style={{ margin: 0 }}>{t("intro")}</p>
      {!open ? (
        <div>
          <Button type="button" onClick={() => void loadOptions()}>{t("linkButton")}</Button>
        </div>
      ) : listError ? (
        <Alert variant="danger" role="alert" title={t("listErrorTitle")}
          action={<Button variant="ghost" size="sm" onClick={() => void loadOptions()}>{t("retry")}</Button>}>
          {t("listError")}
        </Alert>
      ) : options === null ? (
        <p className="sub" role="status" style={{ margin: 0 }}>{t("loadingMeetings")}</p>
      ) : options.length === 0 ? (
        <p className="sub" style={{ margin: 0 }}>
          {t("listEmpty")}{" "}
          <Link href="/meeting/meetings/new" style={{ fontWeight: 600 }}>{t("scheduleMeeting")}</Link>
        </p>
      ) : (
        <div style={{ display: "grid", gap: 8, maxWidth: 480 }}>
          <label htmlFor={selectId} style={{ fontSize: 13, fontWeight: 600 }}>{t("selectLabel")}</label>
          <Select id={selectId} value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">{t("selectPlaceholder")}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}{o.scheduledAt ? ` · ${formatIndianDate(o.scheduledAt)}` : ""}
              </option>
            ))}
          </Select>
          <div style={{ display: "flex", gap: 8 }}>
            <Button type="button" variant="primary" disabled={!choice || busy} aria-busy={busy} onClick={() => void link()}>
              {t("linkConfirm")}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>{t("cancel")}</Button>
          </div>
        </div>
      )}
      {linkError ? (
        <p role="alert" style={{ margin: 0, color: "var(--bad)", fontSize: 14 }}>{t("linkError")}</p>
      ) : null}
    </div>
  );
}

function LinkedMinutes({ governanceMeetingId }: { governanceMeetingId: string }) {
  const t = useEstabT("estabMeetingMom");
  const router = useRouter();
  // undefined = loading, null = none drafted yet, Minutes = the record, "error" = the read failed.
  const [minutes, setMinutes] = useState<Minutes | null | undefined | "error">(undefined);
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMinutes(undefined);
    fetchMinutes(governanceMeetingId)
      .then((m) => { if (!cancelled) setMinutes(m); })
      .catch(() => { if (!cancelled) setMinutes("error"); });
    return () => { cancelled = true; };
  }, [governanceMeetingId]);

  async function start() {
    setBusy(true);
    setStartError(false);
    try {
      await createMinutes(governanceMeetingId);
      router.refresh();
      setMinutes(await fetchMinutes(governanceMeetingId).catch(() => "error" as const));
    } catch {
      setStartError(true);
    } finally {
      setBusy(false);
    }
  }

  const workflow = (
    <Link className="btn ghost" href={`/meeting/meetings/${governanceMeetingId}/minutes`}>{t("openWorkflow")}</Link>
  );

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {minutes === undefined ? (
        <p className="sub" role="status" style={{ margin: 0 }}>{t("checkingMinutes")}</p>
      ) : minutes === "error" ? (
        <Alert variant="warning" role="status" title={t("loadErrorTitle")}>{t("loadError")}</Alert>
      ) : minutes === null ? (
        <>
          <p className="sub" style={{ margin: 0 }}>{t("none")}</p>
          <div>
            <Button type="button" variant="primary" disabled={busy} aria-busy={busy} onClick={() => void start()}>
              {t("startDraft")}
            </Button>
          </div>
        </>
      ) : (
        <p style={{ margin: 0 }}>
          <StatusPill status={minutes.status} label={t(`state_${minutes.status}`)} />
        </p>
      )}
      {startError ? (
        <p role="alert" style={{ margin: 0, color: "var(--bad)", fontSize: 14 }}>{t("startError")}</p>
      ) : null}
      <div>{workflow}</div>
      {minutes !== undefined ? <p className="sub" style={{ margin: 0, fontSize: 12 }}>{t("workflowNote")}</p> : null}
    </div>
  );
}
