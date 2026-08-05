import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { Card, DataTable, PageHeader } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
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
 * A golden profile has no mandatory display name — the label falls back through
 * the identifiers a steward would recognise before giving up and showing the id,
 * so a row is never blank.
 */
function labelOf(attributes: Record<string, unknown>, id: string): string {
  for (const key of ["name", "fullName", "email", "phone"]) {
    const value = attributes[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return id;
}

export default async function CdpProfilesPage() {
  const { data: profiles, source } = await getCdpProfileList();

  const rows: ProfileRow[] = profiles.map((profile) => ({
    id: profile.id,
    name: labelOf(profile.attributes, profile.id),
    profileType: profile.profileType,
    attributes: Object.keys(profile.attributes).length,
    sources: new Set(profile.sourceLineage.map((entry) => entry.source)).size,
    updatedAt: formatIndianDate(profile.updatedAt),
  }));

  return (
    <>
      <PageHeader
        title="CDP — Profiles"
        subtitle="Golden customer profiles resolved from every channel that reported an identifier."
        back="/cdp"
        backLabel="Customer Data Platform"
      />
      {source === "error" && <DataSourceBadge source={source} />}
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
          emptyIcon="👥"
          emptyTitle="No profiles yet"
          emptyMessage="Golden profiles appear once identity resolution has run over ingested customer events."
        />
      </Card>
      <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 12 }}>
        Showing the {rows.length} most recently resolved profiles. Merged profiles are excluded.
      </p>
    </>
  );
}
