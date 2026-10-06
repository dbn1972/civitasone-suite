"use client";

import { DataTable, EmptyState, StatusPill } from "../../../_components/ds";
import { RefreshErrorState } from "../../../_components/ds/RefreshErrorState";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { formatIndianDate, formatPoints } from "@/lib/formatters";
import type { LoyaltyMemberRow } from "../_data";

/**
 * GAP-LOYALTY-MEMBERS-01: tier is its OWN column, never folded into the
 * "Detail"/sublabel chain where a present status hid it. GAP-LOYALTY-MEMBERS-03:
 * enrolledAt renders through formatIndianDate (IST), not a raw ISO string.
 * GAP-LOYALTY-ACCRUALS-03: points via formatPoints (en-IN grouping).
 * GAP-LOYALTY-MEMBERS-02: the member reference (profileId, an opaque CDP UUID —
 * the enrolment payload carries NO name/phone/email) is shown shortened, never
 * the full id, and the page is role-gated server-side.
 */

type MemberTableRow = {
  id: string;
  member: string;
  memberTitle: string;
  tier: string;
  status: string;
  points: string;
  lifetime: string;
  enrolled: string;
};

/** Shorten an opaque UUID reference for display (full value kept in the title). */
function shortRef(id: string | null): string {
  if (!id) return "—";
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return UUID_RE.test(id) ? id.slice(0, 8) : id;
}

export function MembersTable({
  rows,
  source,
  variant = "members",
}: {
  rows: LoyaltyMemberRow[];
  source: "api" | "error";
  /** "members": tier/status focus. "accruals": points-position focus. */
  variant?: "members" | "accruals";
}) {
  const { data, provenance, offline, cachedAt } = useSeededResource<LoyaltyMemberRow[]>(
    variant === "accruals" ? "loyalty.accruals" : "loyalty.members",
    rows,
    source,
    (d) => d.length === 0,
  );

  if ((provenance ?? "live") === "error-no-data") {
    return (
      <div className="card">
        <RefreshErrorState
          error={{
            what: "We couldn't load loyalty members.",
            next: "Check your connection and try again.",
            actions: ["retry", "help"],
          }}
          backHref="/loyalty"
        />
      </div>
    );
  }

  const tableRows: MemberTableRow[] = data.map((m) => ({
    id: m.id,
    member: shortRef(m.profileId),
    memberTitle: m.profileId ?? "",
    tier: m.tier,
    status: m.status,
    points: formatPoints(m.pointsBalance),
    lifetime: formatPoints(m.lifetimePoints),
    enrolled: m.enrolledAt ? formatIndianDate(m.enrolledAt) : "—",
  }));

  return (
    <div className="card">
      <div className="card-h">
        <h3>{variant === "accruals" ? "Points positions" : "Members"}</h3>
      </div>
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      {tableRows.length === 0 ? (
        <EmptyState icon="👥" title="No members" message="No enrolments to show yet for this programme." />
      ) : (
        <DataTable<MemberTableRow>
          columns={[
            { key: "member", label: "Member ref" },
            { key: "tier", label: "Tier", render: (r) => <StatusPill status={r.tier} variant="info" /> },
            { key: "status", label: "Status", cellType: "status" },
            { key: "points", label: "Points balance", align: "right" },
            { key: "lifetime", label: "Lifetime points", align: "right" },
            { key: "enrolled", label: "Enrolled" },
          ]}
          rows={tableRows}
          sortable
          filterable
          filterPlaceholder="Filter members…"
          pageSize={25}
        />
      )}
    </div>
  );
}
