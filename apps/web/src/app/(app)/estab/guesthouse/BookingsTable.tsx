"use client";

import { useState } from "react";
import { DataTable, Segmented } from "@/app/_components/ds";

export type BookingRow = {
  id: string;
  bookingNo: string;
  guest: string;
  room: string;
  dates: string;
  status: string;
  statusRaw: string;
};

const SEGMENTS = ["All", "Pending", "In-house"];

export function BookingsTable({ rows }: { rows: BookingRow[] }) {
  const [seg, setSeg] = useState("All");

  const filtered = rows.filter((r) => {
    switch (seg) {
      case "Pending":
        return r.statusRaw === "pending";
      case "In-house":
        return r.statusRaw === "checked_in";
      default:
        return true;
    }
  });

  return (
    <>
      <div className="card-h">
        <h3>Bookings</h3>
        <Segmented options={SEGMENTS} value={seg} onChange={setSeg} />
      </div>
      <DataTable<BookingRow>
        columns={[
          { key: "bookingNo", label: "Ref" },
          { key: "guest", label: "Guest" },
          { key: "room", label: "Room" },
          { key: "dates", label: "Dates" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={filtered}
        sortable
        filterable
        filterPlaceholder="Filter bookings…"
        pageSize={10}
      />
    </>
  );
}
