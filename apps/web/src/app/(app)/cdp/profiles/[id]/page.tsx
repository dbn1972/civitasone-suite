import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { Card, DataTable, EmptyState, PageHeader, StatCard, StatGrid, StatusPill } from "../../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { getCdpProfile, getCdpProfileIdentity, getCdpProfileTimeline } from "../../_data";
import {
  attributionCoveragePct,
  contributingSources,
  lineageNewestFirst,
  resolveAttributeSources,
} from "./c360";

export const dynamic = "force-dynamic";

type AttributeRow = {
  key: string;
  attribute: string;
  value: string;
  source: string;
  recordedAt: string;
};

type IdentityRow = { id: string; identifierType: string; confidence: string; linkedOn: string };
type EventRow = { id: string; eventType: string; occurredAt: string };
type LineageRow = { id: string; source: string; sourceId: string; recordedAt: string; supplied: string };

export default async function CustomerProfilePage({ params }: { params: { id: string } }) {
  const [{ data: profile, source }, { data: identities }, { data: events }] = await Promise.all([
    getCdpProfile(params.id),
    getCdpProfileIdentity(params.id),
    getCdpProfileTimeline(params.id),
  ]);

  if (!profile) {
    return (
      <>
        <PageHeader title="Customer 360" back="/cdp/profiles" backLabel="Profiles" />
        {source === "error" && <DataSourceBadge source={source} />}
        <EmptyState
          icon="👤"
          title="Profile not found"
          message="This golden profile does not exist, or it was merged into another profile."
        />
      </>
    );
  }

  const attributeSources = resolveAttributeSources(profile);
  const coverage = attributionCoveragePct(attributeSources);
  const systems = contributingSources(profile.sourceLineage);

  const attributeRows: AttributeRow[] = attributeSources.map((entry) => ({
    key: entry.key,
    attribute: entry.key,
    value: entry.value,
    source: entry.source ?? "Unattributed",
    recordedAt: entry.recordedAt ? formatIndianDate(entry.recordedAt) : "—",
  }));

  const identityRows: IdentityRow[] = identities.map((link) => ({
    id: link.id,
    identifierType: link.identifierType,
    confidence: `${link.confidence}%`,
    linkedOn: formatIndianDate(link.createdAt),
  }));

  const eventRows: EventRow[] = events.map((event) => ({
    id: event.id,
    eventType: event.eventType,
    occurredAt: formatIndianDate(event.occurredAt),
  }));

  const lineageRows: LineageRow[] = lineageNewestFirst(profile.sourceLineage).map((entry, index) => ({
    id: `${entry.source}-${entry.sourceId}-${index}`,
    source: entry.source,
    sourceId: entry.sourceId,
    recordedAt: formatIndianDate(entry.timestamp),
    supplied: entry.attributes?.length ? entry.attributes.join(", ") : "Not recorded",
  }));

  return (
    <>
      <PageHeader
        title="Customer 360"
        subtitle={`Golden profile ${profile.id} · ${profile.profileType}`}
        back="/cdp/profiles"
        backLabel="Profiles"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="🧾" iconBg="#e0f2fe" label="Attributes" value={attributeSources.length.toLocaleString("en-IN")} />
        <StatCard icon="🔎" iconBg="#dcfce7" label="Attribution Coverage" value={`${coverage}%`} />
        <StatCard icon="🔗" iconBg="#fef3c7" label="Linked Identifiers" value={identityRows.length.toLocaleString("en-IN")} />
        <StatCard icon="🛰️" iconBg="#fce7f3" label="Contributing Systems" value={systems.length.toLocaleString("en-IN")} />
      </StatGrid>

      <Card title="Attributes and their source of record">
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }}>
          Each value is attributed to the system that last supplied it. An attribute shows as
          <strong> Unattributed</strong> when no ingest recorded which fields it wrote — it is not
          guessed from the most recent contributor.
        </p>
        <DataTable<AttributeRow>
          columns={[
            { key: "attribute", label: "Attribute" },
            { key: "value", label: "Value" },
            { key: "source", label: "Source of Record" },
            { key: "recordedAt", label: "Recorded" },
          ]}
          rows={attributeRows}
          sortable
          filterable
          filterPlaceholder="Filter attributes"
          exportable
          exportFilename={`cdp-profile-${profile.id}-attributes`}
          emptyIcon="🧾"
          emptyTitle="No attributes yet"
          emptyMessage="This profile has been created but no system has contributed attribute values to it."
        />
      </Card>

      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <Card title="Source Lineage">
            <DataTable<LineageRow>
              columns={[
                { key: "source", label: "System" },
                { key: "sourceId", label: "Record" },
                { key: "supplied", label: "Attributes supplied" },
                { key: "recordedAt", label: "Recorded" },
              ]}
              rows={lineageRows}
              emptyIcon="🛰️"
              emptyTitle="No lineage recorded"
              emptyMessage="Provenance appears once an ingesting system appends a lineage entry."
            />
          </Card>

          <Card title="Recent Events">
            <DataTable<EventRow>
              columns={[
                { key: "eventType", label: "Event" },
                { key: "occurredAt", label: "Occurred" },
              ]}
              rows={eventRows}
              emptyIcon="📡"
              emptyTitle="No events yet"
              emptyMessage="Interaction events appear here as channels report them against this profile."
            />
          </Card>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <Card title="Identity Graph">
            <DataTable<IdentityRow>
              columns={[
                { key: "identifierType", label: "Identifier" },
                { key: "confidence", label: "Confidence", align: "right" },
                { key: "linkedOn", label: "Linked" },
              ]}
              rows={identityRows}
              emptyIcon="🔗"
              emptyTitle="No linked identifiers"
              emptyMessage="Identifiers appear once identity resolution links a channel identifier to this profile."
            />
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "12px 0 0" }}>
              Identifier values are stored hashed and are never displayed.
            </p>
          </Card>

          <Card title="Contributing Systems">
            {systems.length === 0 ? (
              <EmptyState
                icon="🛰️"
                title="No contributors"
                message="No system has appended a lineage entry to this profile."
              />
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                {systems.map((system) => (
                  <li key={system.source} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <StatusPill status={system.source} />
                    <span style={{ fontSize: 13, color: "var(--muted)" }}>
                      last contributed {formatIndianDate(system.lastSeen)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Record">
            <div className="fields">
              <div className="fld"><div className="l">Profile type</div><div className="v">{profile.profileType}</div></div>
              <div className="fld"><div className="l">Created</div><div className="v">{formatIndianDate(profile.createdAt)}</div></div>
              <div className="fld"><div className="l">Last updated</div><div className="v">{formatIndianDate(profile.updatedAt)}</div></div>
              <div className="fld"><div className="l">Version</div><div className="v">{profile.version}</div></div>
              <div className="fld"><div className="l">Merged from</div><div className="v">{profile.mergedFromIds.length || "—"}</div></div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
