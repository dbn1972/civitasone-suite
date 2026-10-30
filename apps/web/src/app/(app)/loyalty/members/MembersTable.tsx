"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
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
 * GAP-LOYALTY-MEMBERS-02: the member reference (profile id, an opaque CDP UUID —
 * the enrolment payload carries NO name/phone/email) is personal data (owner
 * decision D4c #14/#15): shown shortened, never the full id, role-gated
 * server-side, and revealed in full only through an audited request.
 */

type MemberTableRow = {
  id: string;
  member: string;
  tier: string;
  status: string;
  points: string;
  lifetime: string;
  enrolled: string;
};

/**
 * D4c #14/#15: the member reference is personal data. Rows carry only the shortened reference; the
 * full profile id is fetched on request from the audited reveal endpoint and held in component state
 * only (never in the offline cache, the DOM title, or the row data).
 */
function ProfileRefCell({ enrolmentId, profileRef }: { enrolmentId: string; profileRef: string }) {
  const t = useTranslations("loyaltyMembers");
  const [full, setFull] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function reveal() {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/proxy/v1/loyalty/enrolments/${encodeURIComponent(enrolmentId)}/profile-ref`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) {
        setFailed(true);
        return;
      }
      const body = (await res.json()) as { data?: { profileId?: unknown } };
      if (typeof body.data?.profileId === "string") setFull(body.data.profileId);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (profileRef === "—") return <span>—</span>;
  return (
    <span>
      <span>{full ?? profileRef}</span>{" "}
      {full === null ? (
        <button type="button" className="btn ghost" disabled={busy} onClick={reveal} aria-label={t("revealAria", { ref: profileRef })}>
          {busy ? t("revealing") : t("reveal")}
        </button>
      ) : (
        <button type="button" className="btn ghost" onClick={() => setFull(null)}>
          {t("hide")}
        </button>
      )}
      {failed && (
        <span role="alert" style={{ color: "var(--bad)", fontSize: 12, marginInlineStart: 6 }}>
          {t("revealFailed")}
        </span>
      )}
    </span>
  );
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
    // D4c #15: v2 keys orphan any earlier offline-cache entry that still holds a full profile id.
    variant === "accruals" ? "loyalty.accruals.v2" : "loyalty.members.v2",
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
    member: m.profileRef ?? "—",
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
            { key: "member", label: "Member ref", render: (r) => <ProfileRefCell enrolmentId={r.id} profileRef={r.member} /> },
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
