"use client";

import { useMemo, useState } from "react";
import { Segmented } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { BreakglassActions } from "./BreakglassActions";

type Event = {
  id: string;
  actor: string;
  actorEmail: string;
  reason: string;
  startedAt: string;
  endedAt?: string;
  status: "active" | "ended" | "auto_expired";
};

const FILTERS = ["All", "Active", "Ended"] as const;

export function BreakglassTable({ events }: { events: Event[] }) {
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
      <table className="tbl" aria-labelledby="bg-table-heading">
        <thead>
          <tr>
            <th scope="col">Requester</th>
            <th scope="col">Reason</th>
            <th scope="col">Requested</th>
            <th scope="col">Duration</th>
            <th scope="col">Status</th>
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((event) => (
            <tr key={event.id}>
              <td>
                <div className="who">
                  <div className="av">{event.actor.slice(0, 2).toUpperCase()}</div>
                  <div>
                    <div className="nm">{event.actor}</div>
                    <div className="ml">{event.actorEmail}</div>
                  </div>
                </div>
              </td>
              <td style={{ maxWidth: 200 }}>{event.reason}</td>
              <td>{formatIndianDate(event.startedAt)}</td>
              <td>{event.endedAt ? "Ended" : "Ongoing"}</td>
              <td>
                {event.status === "active" ? <span className="pill bad">Active</span>
                  : event.status === "ended" ? <span className="pill good">Ended</span>
                  : <span className="pill mut">{event.status.replace(/_/g, " ")}</span>}
              </td>
              <td>
                {event.status === "active"
                  ? <BreakglassActions id={event.id} requester={event.actor} />
                  : <span style={{ fontSize: 12, color: "#98a2b3" }}>—</span>}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={6}><div className="empty-state"><div>🔑</div><h4>No break-glass events</h4><p>No events match this filter.</p></div></td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
