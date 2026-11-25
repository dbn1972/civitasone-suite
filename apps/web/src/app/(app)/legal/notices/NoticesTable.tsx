"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, DataTable, Modal, Segmented, StatusPill } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { formatIndianDate } from "@/lib/formatters";
import { useFormError } from "@/lib/useFormError";
import { useSeededResource } from "@/lib/sync/resource";
import type { LegalNoticeSummary } from "@civitasone/types";

type Row = LegalNoticeSummary & Record<string, unknown>;

const FILTERS = ["all", "open"] as const;

/**
 * Notice register. Responding calls POST /api/v1/legal/notices/:id/respond
 * (respondNoticeBody: { responseBody }, 1..8000 chars); legal-service only accepts a response
 * while the notice is `open` (notices/domain.ts assertCanRespond), so the action is offered
 * only on open rows. The route is role-gated server-side; this page is already behind the
 * LEGAL_OPERATOR_ROLES layout.
 */
export function NoticesTable({ items, source = "api" }: { items: LegalNoticeSummary[]; source?: "api" | "error" }) {
  const t = useTranslations("legalNotices");
  const router = useRouter();
  const formError = useFormError("legal notice");
  const { data: rows0, provenance, offline, cachedAt } = useSeededResource<LegalNoticeSummary[]>(
    "legal.notices",
    items,
    source,
    (d) => d.length === 0,
  );
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [target, setTarget] = useState<LegalNoticeSummary | null>(null);
  const [responseBody, setResponseBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");

  const rows = useMemo<Row[]>(() => {
    const base = rows0 as Row[];
    return filter === "open" ? base.filter((r) => r.status === "open") : base;
  }, [rows0, filter]);

  function close() {
    setTarget(null);
    setResponseBody("");
    setMessage("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    if (responseBody.trim().length < 1) {
      setMessage(t("responseRequired"));
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/legal/notices/${encodeURIComponent(target.id)}/respond`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ responseBody: responseBody.trim().slice(0, 8000) }),
      });
      if (!res.ok) throw UserFacingError.from(await formError.fromResponse(res, "save"));
      close();
      setNotice(t("responseQueued"));
      router.refresh();
    } catch (caught) {
      setMessage(caught instanceof UserFacingError ? caught.message : formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-h">
        <h3>{t("tableTitle")}</h3>
        <Segmented
          options={FILTERS.map((f) => (f === "all" ? t("filterAll") : t("filterOpen")))}
          value={filter === "all" ? t("filterAll") : t("filterOpen")}
          onChange={(label) => setFilter(label === t("filterOpen") ? "open" : "all")}
        />
      </div>
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <div role="status" aria-live="polite">
        {notice ? <p style={{ margin: "8px 16px", fontSize: 13, color: "var(--good)" }}>{notice}</p> : null}
      </div>
      <DataTable<Row>
        columns={[
          { key: "noticeNo", label: t("colNoticeNo"), render: (r) => <span className="mono">{r.noticeNo}</span> },
          { key: "subject", label: t("colSubject") },
          { key: "partyRef", label: t("colParty") },
          { key: "direction", label: t("colDirection"), render: (r) => <>{r.direction === "received" ? t("directionReceived") : t("directionSent")}</> },
          {
            key: "status",
            label: t("colStatus"),
            render: (r) => <StatusPill status={r.status} label={r.status === "open" ? t("statusOpen") : t("statusResponded")} />,
          },
          { key: "createdAt", label: t("colRegistered"), render: (r) => <>{r.createdAt ? formatIndianDate(r.createdAt) : "—"}</> },
          {
            key: "actions",
            label: t("colActions"),
            render: (r) =>
              r.status === "open" ? (
                <Button variant="ghost" size="sm" aria-label={t("respondFor", { noticeNo: r.noticeNo })} onClick={() => { setNotice(""); setTarget(r); }}>
                  {t("respond")}
                </Button>
              ) : (
                <span aria-hidden="true">—</span>
              ),
          },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder={t("filterPlaceholder")}
        pageSize={15}
      />

      <Modal open={target !== null} onClose={close} title={target ? t("respondTitle", { noticeNo: target.noticeNo }) : ""} size="md">
        <form className="pad" onSubmit={submit} noValidate>
          <p style={{ fontSize: 12, color: "var(--warn)", margin: "0 0 12px" }}>{t("respondHint")}</p>
          {target ? <p style={{ fontSize: 13, margin: "0 0 12px" }}>{target.subject}</p> : null}
          <label className="label" htmlFor="noticeResponse">{t("responseLabel")}</label>
          <textarea
            id="noticeResponse"
            className="inp"
            rows={6}
            value={responseBody}
            onChange={(e) => setResponseBody(e.target.value)}
            required
            maxLength={8000}
            placeholder={t("responsePlaceholder")}
            style={{ width: "100%" }}
          />
          <div role="status" aria-live="polite">
            {message ? <p role="alert" style={{ marginTop: 8, color: "var(--bad)", fontSize: "0.875rem" }}>{message}</p> : null}
          </div>
          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>{busy ? t("saving") : t("submitResponse")}</Button>
            <Button type="button" variant="ghost" style={{ minHeight: 44 }} onClick={close} disabled={busy}>{t("cancel")}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
