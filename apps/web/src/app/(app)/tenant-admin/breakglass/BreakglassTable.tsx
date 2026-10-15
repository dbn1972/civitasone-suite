"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Segmented, DataTable } from "../../../_components/ds";
import { formatIndianDate, formatDuration } from "@/lib/formatters";
import { useTranslations } from "next-intl";
import { BreakglassActions } from "./BreakglassActions";

type Event = {
  id: string;
  actor: string;
  actorEmail: string;
  reason: string;
  startedAt: string;
  endedAt?: string;
  status: "active" | "ended" | "auto_expired";
} & Record<string, unknown>;

const FILTERS = ["All", "Active", "Ended"] as const;

/**
 * GAP-TENANT-ADMIN-BREAKGLASS-05: closing an emergency session is a platform
 * authority (identity-service POST /identity/break-glass/:id/close is
 * platform_admin / super_admin only). `canClose` mirrors that gate so the
 * control is not offered to a role the server will refuse; the server remains
 * the enforcement. Whether the requester may close their own session is a
 * policy decision (closing reduces risk) -- left to the owner, not invented here.
 */
export function BreakglassTable({ events, canClose }: { events: Event[]; canClose: boolean }) {
  const t = useTranslations("tenantAdminW2.breakglass");
  const [filter, setFilter] = useState<string>("All");

  const rows = useMemo(() => {
    if (filter === "All") return events;
    if (filter === "Active") return events.filter((e) => e.status === "active");
    return events.filter((e) => e.status !== "active");
  }, [events, filter]);

  return (
    <div className="card">
      <div className="card-h">
        <h3 id="bg-table-heading">Break-glass log</h3>
        <div role="group" aria-label="Filter break-glass events by status">
          <Segmented options={[...FILTERS]} value={filter} onChange={setFilter} />
        </div>
      </div>
      <DataTable<Event>
        columns={[
          {
            key: "actor",
            label: "Requester",
            render: (event) => (
              <div className="who">
                <div className="av" aria-hidden="true">{event.actor.slice(0, 2).toUpperCase()}</div>
                <div>
                  {/* GAP-TENANT-ADMIN-BREAKGLASS-04 / DETAIL-02: link to the
                      real detail route (now backed by a live fetch). */}
                  <div className="nm">
                    <Link href={`/tenant-admin/breakglass/${event.id}`}>{event.actor}</Link>
                  </div>
                  <div className="ml">{event.actorEmail}</div>
                </div>
              </div>
            ),
          },
          { key: "reason", label: "Reason", render: (event) => <span style={{ display: "inline-block", maxWidth: 200 }}>{event.reason}</span> },
          { key: "startedAt", label: "Requested", render: (event) => formatIndianDate(event.startedAt) },
          {
            key: "endedAt",
            label: "Duration",
            // GAP-TENANT-ADMIN-BREAKGLASS-03: show real elapsed time, label
            // auto_expired correctly, and show a live "Ongoing" elapsed span.
            render: (event) =>
              event.status === "auto_expired"
                ? `Auto-expired${event.endedAt ? ` after ${formatDuration(event.startedAt, event.endedAt)}` : ""}`
                : event.status === "active"
                  ? `Ongoing · ${formatDuration(event.startedAt)}`
                  : formatDuration(event.startedAt, event.endedAt),
          },
          {
            key: "status",
            label: "Status",
            render: (event) =>
              event.status === "active" ? <span className="pill bad">Active</span>
                : event.status === "ended" ? <span className="pill good">Ended</span>
                : <span className="pill mut">{event.status.replace(/_/g, " ")}</span>,
          },
          {
            key: "id",
            label: "Actions",
            sortable: false,
            render: (event) =>
              event.status === "active"
                ? (canClose
                  ? <BreakglassActions id={event.id} requester={event.actor} />
                  : <span style={{ fontSize: 12, color: "var(--mut)" }}>{t("platformAdminOnly")}</span>)
                : <span style={{ fontSize: 12, color: "var(--mut)" }}>—</span>,
          },
        ]}
        rows={rows}
      />
    </div>
  );
}
