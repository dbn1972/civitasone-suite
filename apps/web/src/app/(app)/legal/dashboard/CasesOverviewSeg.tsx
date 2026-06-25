"use client";

import { useState } from "react";
import { Segmented } from "../../../_components/ds";

const FILTERS = ["All", "High Court", "Tribunals"] as const;

export function CasesOverviewSeg({
  activeCases,
  hearingsThisWeek,
  ordersPending,
}: {
  activeCases: number;
  hearingsThisWeek: number;
  ordersPending: number;
}) {
  const [scope, setScope] = useState<string>("All");

  return (
    <div className="card">
      <div className="card-h">
        <h3>Cases overview</h3>
        <Segmented options={[...FILTERS]} value={scope} onChange={setScope} />
      </div>
      <div className="pad" style={{ color: "#667085", fontSize: 13 }}>
        <span style={{ fontWeight: 600 }}>{scope}</span> &nbsp;·&nbsp; Active cases: {activeCases} &nbsp;·&nbsp; Hearings this week: {hearingsThisWeek} &nbsp;·&nbsp; Orders pending: {ordersPending}
      </div>
    </div>
  );
}
