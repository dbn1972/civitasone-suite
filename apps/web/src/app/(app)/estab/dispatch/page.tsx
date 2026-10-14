"use client";

import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import Link from "next/link";
import { useCallback, useState } from "react";
import {
  Button, PageHeader, StatusPill, DataTable, EmptyState, ErrorState, ActionButton,
} from "../../../_components/ds";
import { formatIndianDate, humanizeStatus } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { UserFacingError } from "@/lib/userFacingError";
import { useFormError } from "@/lib/useFormError";
import { useSessionIdentity } from "@/lib/auth/useSessionIdentity";
import { ESTAB_FILES_WRITE_ROLES } from "@/lib/estab/roles";
import { useEstabT } from "@/lib/estab/useEstabT";
import { usePagedRegister } from "@/lib/estab/usePagedRegister";

/** Dispatch modes the service accepts (createDispatchBody). */
const DISPATCH_MODES = ["email", "post", "courier", "fax", "hand"] as const;

type DispatchRow = {
  id: string;
  dispatchNo: string;
  toAddress: string;
  subject: string;
  mode: string;
  status: string;
  fileId?: string | null;
  dispatchedAt?: string | null;
  deliveryStatus?: string;
  deliveredAt?: string | null;
  deliveryProof?: string | null;
};

export default function DispatchRegistryPage() {
  const t = useEstabT();
  const formError = useFormError("dispatch");
  const identity = useSessionIdentity();
  // The dispatch and delivery routes are estab-officer only; the service stays the authority.
  const canWrite = identity.roles.some((r) => ESTAB_FILES_WRITE_ROLES.includes(r));
  const reg = usePagedRegister<DispatchRow>("/api/proxy/v1/estab/dispatch");
  const { rows, total, loading, failed: error } = reg;

  const [entry, setEntry] = useState({ toAddress: "", mode: "email", subject: "" });
  const [entryError, setEntryError] = useState("");
  const [entryMessage, setEntryMessage] = useState("");
  const [saving, setSaving] = useState(false);

  // GAP-ESTAB-DISPATCH-02: record delivery acknowledgement via the existing
  // POST /v1/estab/dispatch/delivery endpoint (deliveryUpdateBody). The POD /
  // speed-post number goes in deliveryProof; the service stamps deliveredAt and audits it.
  const recordDelivery = useCallback(
    async (dispatchId: string, reason?: string) => {
      const res = await fetch("/api/proxy/v1/estab/dispatch/delivery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dispatchId,
          deliveryStatus: "delivered",
          deliveryProof: reason ?? "",
        }),
      });
      if (!res.ok) {
        const resolved = await userFacingErrorFromResponse(res, "save");
        throw UserFacingError.from(resolved);
      }
      await reg.reload();
    },
    [reg],
  );

  // GAP-ESTAB-DISPATCH-02: log a manual dispatch (POST /v1/estab/dispatch).
  async function logDispatch(e: React.FormEvent) {
    e.preventDefault();
    setEntryError("");
    setEntryMessage("");
    const toAddress = entry.toAddress.trim();
    const subject = entry.subject.trim();
    if (!toAddress || !subject) {
      setEntryError(t("dispatchErrRequired"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/proxy/v1/estab/dispatch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toAddress, subject, mode: entry.mode }),
      });
      if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
      setEntry({ toAddress: "", mode: "email", subject: "" });
      // Written asynchronously (202): the dispatch number is assigned when it is processed.
      setEntryMessage(t("dispatchLogged"));
      await reg.reload();
    } catch (err) {
      setEntryError(formError.fromException("save", err).message);
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)", minHeight: 44 } as const;
  const fieldProps = { className: "fld", style: { flexDirection: "column", alignItems: "flex-start" } } as const;

  return (
    <>
      <PageHeader title={t("dispatchTitle")} subtitle={t("dispatchSubtitle")} back="/estab" />

      {canWrite ? (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-h"><h3>{t("dispatchLogHeading")}</h3></div>
          <form onSubmit={logDispatch} className="pad" noValidate>
            <div className="fields">
              <div {...fieldProps}>
                <label className="l" htmlFor="dsp-to">{t("dispatchTo")}</label>
                <input id="dsp-to" required value={entry.toAddress} onChange={(e) => setEntry({ ...entry, toAddress: e.target.value })} style={inputStyle} />
              </div>
              <div {...fieldProps}>
                <label className="l" htmlFor="dsp-subject">{t("dakSubject")}</label>
                <input id="dsp-subject" required value={entry.subject} onChange={(e) => setEntry({ ...entry, subject: e.target.value })} style={inputStyle} />
              </div>
              <div {...fieldProps}>
                <label className="l" htmlFor="dsp-mode">{t("dispatchMode")}</label>
                <select id="dsp-mode" value={entry.mode} onChange={(e) => setEntry({ ...entry, mode: e.target.value })} style={inputStyle}>
                  {DISPATCH_MODES.map((m) => <option key={m} value={m}>{humanizeStatus(m)}</option>)}
                </select>
              </div>
            </div>
            <div role="status" aria-live="polite">
              {entryMessage ? <p style={{ color: "var(--good)", fontSize: 13, marginTop: 8 }}>{entryMessage}</p> : null}
            </div>
            <div role="alert" aria-live="assertive">
              {entryError ? <p style={{ color: "var(--bad)", fontSize: 13, marginTop: 8 }}>{entryError}</p> : null}
            </div>
            <Button type="submit" disabled={saving} style={{ marginTop: 12 }}>{saving ? t("saving") : t("dispatchLogBtn")}</Button>
          </form>
        </div>
      ) : null}

      <div className="card">
        <div className="card-h">
          <h3>{t("dispatchRegisterHeading")}</h3>
          {/* GAP-ESTAB-DISPATCH-04: how much of the register is on screen. */}
          {!loading && !error && total > 0 && (
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{t("showingOf", { shown: rows.length, total })}</span>
          )}
        </div>
        <div className="pad" style={{ paddingBottom: 0 }}>
          {/* GAP-ESTAB-DISPATCH-04: search runs on the server, over the whole register. */}
          <label className="l" htmlFor="dsp-search">{t("dispatchSearchLabel")}</label>
          <input
            id="dsp-search"
            type="search"
            value={reg.searchInput}
            onChange={(e) => reg.setSearchInput(e.target.value)}
            placeholder={t("dispatchSearchPlaceholder")}
            style={inputStyle}
          />
        </div>
        {loading ? (
          <p className="pad" style={{ textAlign: "center", color: "var(--mut)" }}>{t("loading")}</p>
        ) : error ? (
          <div className="pad"><ErrorState error={toHumanError("load", { area: "dispatch register" })} onRetry={() => void reg.reload()} /></div>
        ) : rows.length === 0 && reg.query ? (
          <EmptyState icon="🔎" title={t("dispatchNoMatchTitle")} message={t("dispatchNoMatchMessage")} />
        ) : rows.length === 0 ? (
          <EmptyState icon="📮" title={t("dispatchEmptyTitle")} message={t("dispatchEmptyMessage")} />
        ) : (
          <>
            <DataTable<DispatchRow>
              columns={[
                { key: "dispatchNo", label: t("dispatchColNo"), render: (r) => <span className="mono">{r.dispatchNo}</span> },
                { key: "toAddress", label: t("dispatchColTo") },
                { key: "subject", label: t("dakSubject") },
                {
                  // GAP-ESTAB-DISPATCH-03: humanize mode
                  key: "mode", label: t("dispatchMode"),
                  render: (r) => <>{humanizeStatus(r.mode)}</>,
                },
                {
                  // GAP-ESTAB-DISPATCH-03: "Not yet dispatched" for null date
                  key: "dispatchedAt", label: t("dispatchColDate"),
                  render: (r) => r.dispatchedAt
                    ? <>{formatIndianDate(r.dispatchedAt)}</>
                    : <span style={{ color: "var(--mut)" }}>{t("dispatchNotYet")}</span>,
                },
                {
                  // GAP-ESTAB-DISPATCH-03: humanize status
                  key: "status", label: t("colStatus"),
                  render: (r) => <StatusPill status={r.status} />,
                },
                {
                  // GAP-ESTAB-DISPATCH-01: file link column
                  key: "fileId", label: t("colFile"),
                  render: (r) => r.fileId
                    ? <Link href={`/estab/files/${r.fileId}`} className="lnk">{t("viewFile")}</Link>
                    : <span style={{ color: "var(--mut)" }}>—</span>,
                },
                {
                  // GAP-ESTAB-DISPATCH-02: record acknowledgement (estab officers only)
                  key: "id", label: t("colAction"), sortable: false,
                  render: (r) =>
                    r.deliveryStatus === "delivered" ? (
                      <span style={{ color: "var(--good)" }}>
                        {r.deliveredAt ? t("dispatchDeliveredOn", { date: formatIndianDate(r.deliveredAt) }) : t("dispatchDelivered")}
                        {r.deliveryProof ? <span className="mono" style={{ marginInlineStart: 6 }}>{r.deliveryProof}</span> : null}
                      </span>
                    ) : canWrite && r.status !== "pending" ? (
                      <ActionButton
                        label={t("dispatchAcknowledge")}
                        className="btn ghost"
                        confirmTitle={t("dispatchAckTitle", { dispatchNo: r.dispatchNo })}
                        confirmDescription={t("dispatchAckDesc")}
                        confirmLabel={t("dispatchAckConfirm")}
                        requireReason
                        reasonLabel={t("dispatchAckReason")}
                        onConfirm={(reason) => recordDelivery(r.id, reason)}
                      />
                    ) : (
                      <span style={{ color: "var(--mut)" }}>—</span>
                    ),
                },
              ]}
              rows={rows}
              sortable
              pageSize={15}
            />
            {reg.hasMore ? (
              <div className="pad" style={{ textAlign: "center" }}>
                <Button type="button" variant="ghost" disabled={reg.loadingMore} onClick={() => void reg.loadMore()}>
                  {reg.loadingMore ? t("loading") : t("loadMore")}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
