"use client";

import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  PageHeader, StatusPill, DataTable, EmptyState, ErrorState, ActionButton,
} from "../../../_components/ds";
import { formatIndianDate, humanizeStatus } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { UserFacingError } from "@/lib/userFacingError";

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
};

export default function DispatchRegistryPage() {
  const [rows, setRows] = useState<DispatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/proxy/v1/estab/dispatch?limit=100", { signal });
      if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
      const body = await res.json() as { data?: DispatchRow[] };
      setRows(body.data ?? []);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // GAP-ESTAB-DISPATCH-02: record delivery acknowledgement via the existing
  // POST /v1/estab/dispatch/delivery endpoint (deliveryUpdateBody).
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
      await load();
    },
    [load],
  );

  return (
    <>
      <PageHeader
        title="Outward Dispatch Register"
        subtitle="Track dispatches linked to eOffice files."
        back="/estab"
      />
      <div className="card">
        <div className="card-h">
          <h3>Dispatch register</h3>
          {/* GAP-ESTAB-DISPATCH-04: truncation notice */}
          {!loading && !error && rows.length === 100 && (
            <span style={{ fontSize: 12, color: "var(--mut)" }}>Showing latest 100 entries</span>
          )}
        </div>
        {loading ? (
          <p className="pad" style={{ textAlign: "center", color: "var(--mut)" }}>Loading…</p>
        ) : error ? (
          <div className="pad"><ErrorState error={toHumanError("load", { area: "dispatch register" })} onRetry={() => void load()} /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon="📮" title="No dispatches yet" message="Outward dispatches linked to eOffice files will appear here." />
        ) : (
          <DataTable<DispatchRow>
            columns={[
              { key: "dispatchNo", label: "Dispatch No", render: (r) => <span className="mono">{r.dispatchNo}</span> },
              { key: "toAddress", label: "To" },
              { key: "subject", label: "Subject" },
              {
                // GAP-ESTAB-DISPATCH-03: humanize mode
                key: "mode", label: "Mode",
                render: (r) => <>{humanizeStatus(r.mode)}</>,
              },
              {
                // GAP-ESTAB-DISPATCH-03: "Not yet dispatched" for null date
                key: "dispatchedAt", label: "Date",
                render: (r) => r.dispatchedAt
                  ? <>{formatIndianDate(r.dispatchedAt)}</>
                  : <span style={{ color: "var(--mut)" }}>Not yet dispatched</span>,
              },
              {
                // GAP-ESTAB-DISPATCH-03: humanize status
                key: "status", label: "Status",
                render: (r) => <StatusPill status={r.status} />,
              },
              {
                // GAP-ESTAB-DISPATCH-01: file link column
                key: "fileId", label: "File",
                render: (r) => r.fileId
                  ? <Link href={`/estab/files/${r.fileId}`} className="lnk">View file</Link>
                  : <span style={{ color: "var(--mut)" }}>—</span>,
              },
              {
                // GAP-ESTAB-DISPATCH-02: record acknowledgement
                key: "id", label: "Action", sortable: false,
                render: (r) =>
                  r.deliveryStatus !== "delivered" && r.status !== "pending" ? (
                    <ActionButton
                      label="Acknowledge"
                      className="btn ghost"
                      confirmTitle={`Record delivery for dispatch ${r.dispatchNo}?`}
                      confirmDescription="Records that this dispatch has been delivered. Add POD / speed-post number in remarks."
                      confirmLabel="Mark delivered"
                      requireReason
                      reasonLabel="POD / Speed-post number / remarks"
                      onConfirm={(reason) => recordDelivery(r.id, reason)}
                    />
                  ) : r.deliveryStatus === "delivered" ? (
                    <span style={{ color: "var(--good)" }}>✔ Delivered</span>
                  ) : (
                    <span style={{ color: "var(--mut)" }}>—</span>
                  ),
              },
            ]}
            rows={rows}
            sortable
            filterable
            filterPlaceholder="Filter dispatches…"
            pageSize={15}
          />
        )}
      </div>
    </>
  );
}
