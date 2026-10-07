import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { Card, DataTable, PageHeader, StatGrid, StatCard } from "../../../_components/ds";
import { RefreshErrorState } from "../../../_components/ds/RefreshErrorState";
import { maskEmail, maskPhone } from "../../../_components/ds/Masked";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getCdpProfileList } from "../_data";

export const dynamic = "force-dynamic";

type ProfileRow = {
  id: string;
  name: string;
  profileType: string;
  attributes: number;
  sources: number;
  updatedAt: string;
};

/**
 * A golden profile has no mandatory display name. The label prefers a real
 * name, then falls back to a DPDP-masked contact identifier (GAP-CDP-PROFILES-01:
 * email/phone must never render in full in the list or its CSV export), and only
 * then to a short, non-UUID reference (GAP-CDP-PROFILES-03: a 36-char UUID is
 * internal plumbing, not a label). The full id always stays in the row link.
 */
function labelOf(attributes: Record<string, unknown>, id: string, profileType: string): string {
  for (const key of ["name", "fullName"]) {
    const value = attributes[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const email = attributes.email;
  if (typeof email === "string" && email.trim()) return maskEmail(email.trim());
  const phone = attributes.phone;
  if (typeof phone === "string" && phone.trim()) return maskPhone(phone.trim());
  // No recognizable identifier: a short, typed reference instead of a raw UUID.
  const typeLabel = profileType && profileType.trim() ? profileType.trim() : "Profile";
  return `${typeLabel} · …${id.slice(-6)}`;
}

export default async function CdpProfilesPage() {
  const { data, source } = await getCdpProfileList();
  const { profiles, total, limit } = data;
  const errored = source === "error";

  const rows: ProfileRow[] = profiles.map((profile) => ({
    id: profile.id,
    name: labelOf(profile.attributes, profile.id, profile.profileType),
    profileType: profile.profileType,
    attributes: Object.keys(profile.attributes).length,
    sources: new Set(profile.sourceLineage.map((entry) => entry.source)).size,
    updatedAt: formatIndianDate(profile.updatedAt),
  }));

  const multiSource = rows.filter((r) => r.sources > 1).length;
  const withIdentity = rows.filter((r) => r.sources > 0).length;
  const avgAttributes =
    rows.length > 0 ? Math.round(rows.reduce((s, r) => s + r.attributes, 0) / rows.length).toString() : "0";

  return (
    <>
      <PageHeader
        title="CDP — Profiles"
        subtitle="Golden customer profiles resolved from every channel that reported an identifier."
        back="/cdp"
        backLabel="Customer Data Platform"
      />
      {errored && <DataSourceBadge source={source} />}
      <StatGrid>
        {/* GAP-CDP-PROFILES-02: on a load failure these must read "—", not a
            fabricated "0" that a steward could take as "zero profiles exist". */}
        <StatCard icon="👤" iconBg="#e0f2fe" label="Total Profiles" value={errored ? "—" : total.toLocaleString("en-IN")} />
        <StatCard icon="🔗" iconBg="#dcfce7" label="With Identity" value={errored ? "—" : withIdentity.toLocaleString("en-IN")} />
        <StatCard icon="🛰️" iconBg="#fef3c7" label="Multi-Source" value={errored ? "—" : multiSource.toLocaleString("en-IN")} />
        <StatCard icon="📊" iconBg="#fce7f3" label="Avg Attributes (loaded)" value={errored ? "—" : avgAttributes} />
      </StatGrid>
      {errored ? (
        <Card title="Golden Profiles">
          <RefreshErrorState error={toHumanError("load", { area: "profiles" })} source={{ area: "profiles" }} />
        </Card>
      ) : (
        <>
          <Card title="Golden Profiles">
            <DataTable<ProfileRow>
              columns={[
                { key: "name", label: "Profile" },
                { key: "profileType", label: "Type" },
                { key: "attributes", label: "Attributes", align: "right" },
                { key: "sources", label: "Sources", align: "right" },
                { key: "updatedAt", label: "Last updated" },
              ]}
              rows={rows}
              rowLinkKey="id"
              rowLinkPrefix="/cdp/profiles/"
              sortable
              filterable
              filterPlaceholder="Filter profiles"
              pageSize={25}
              exportable
              exportFilename="cdp-profiles"
              emptyIcon="👥"
              emptyTitle="No profiles yet"
              emptyMessage="Golden profiles appear once identity resolution has run over ingested customer events."
            />
          </Card>
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 12 }}>
            {total > rows.length
              ? `Showing the latest ${rows.length.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")} profiles (capped at ${limit}). The Multi-Source and Avg Attributes figures are computed on this loaded page only. Merged profiles are excluded.`
              : `Showing the ${rows.length.toLocaleString("en-IN")} most recently resolved profiles. Merged profiles are excluded.`}
          </p>
        </>
      )}
    </>
  );
}
