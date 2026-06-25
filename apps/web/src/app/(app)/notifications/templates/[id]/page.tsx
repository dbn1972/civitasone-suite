"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PageHeader, Card, DataTable, EmptyState } from "../../../../_components/ds";
import { StatusBadge } from "../../_components/StatusBadge";

/**
 * Template detail — backed by GET /notification/templates/:id/versions, which
 * returns the template's version history (latest first). The latest version is
 * rendered as the current content; older versions are listed in a DataTable.
 * There is no plain GET-by-id route on the service, so the versions endpoint is
 * the single source of truth here.
 */
type TemplateView = {
  id: string;
  channel: string;
  name: string;
  subject: string | null;
  body: string;
  status: string;
  version: number;
  supersededBy: string | null;
};

type VersionRow = {
  version: number;
  status: string;
  channel: string;
  subject: string;
} & Record<string, unknown>;

function toArray(raw: unknown): TemplateView[] {
  if (Array.isArray(raw)) return raw as TemplateView[];
  if (raw && typeof raw === "object") {
    const rec = raw as Record<string, unknown>;
    if (Array.isArray(rec.data)) return rec.data as TemplateView[];
  }
  return [];
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
      <span style={{ fontSize: 12, color: "#667085" }}>{label}</span>
      <span style={{ fontSize: 13, textAlign: "right", wordBreak: "break-word" }}>{children}</span>
    </div>
  );
}

export default function TemplateDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [versions, setVersions] = useState<TemplateView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    if (!id) return;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/proxy/notification/templates/${id}/versions`, {
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error(`HTTP_${res.status}`);
        setVersions(toArray(await res.json()));
      } catch (err) {
        setError(err instanceof Error ? err.message : "load failed");
      } finally {
        setLoading(false);
      }
    })();
  }

  useEffect(load, [id]);

  if (loading) {
    return (
      <>
        <PageHeader title="Template" subtitle="Loading template…" back="/notifications/templates" />
        <Card padding>
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#667085" }}>Loading template…</p>
        </Card>
      </>
    );
  }

  const latest = versions[0];

  if (error || !latest) {
    return (
      <>
        <PageHeader title="Template" back="/notifications/templates" />
        <Card padding>
          <EmptyState
            icon="📭"
            title={error ? "Couldn't load this template" : "Template not found"}
            message={error ? "There was a problem loading this template. Please try again." : "This template does not exist or is not visible to your tenant."}
            action={
              error ? (
                <button type="button" className="btn primary" onClick={load}>Try again</button>
              ) : (
                <a className="btn ghost" href="/notifications/templates">Back to templates</a>
              )
            }
          />
        </Card>
      </>
    );
  }

  const history: VersionRow[] = versions.map((v) => ({
    version: v.version,
    status: v.supersededBy ? "superseded" : v.status,
    channel: v.channel.replace(/_/g, " "),
    subject: v.subject ?? "—",
  }));

  return (
    <>
      <PageHeader
        title={latest.name}
        subtitle="Template content and version history."
        back="/notifications/templates"
        actions={<a className="btn primary" href="/notifications/compose">Send with this template</a>}
      />

      <div className="grid g-main" style={{ marginTop: 18 }}>
        <Card title="Current version" padding>
          <Row label="Status"><StatusBadge status={latest.supersededBy ? "superseded" : latest.status} /></Row>
          <Row label="Channel">{latest.channel.replace(/_/g, " ")}</Row>
          <Row label="Version">{latest.version}</Row>
          <Row label="Subject">{latest.subject ?? "—"}</Row>
          <div style={{ paddingTop: 12 }}>
            <div style={{ fontSize: 12, color: "#667085", marginBottom: 4 }}>Body</div>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, background: "var(--bg-soft, #f8fafc)", padding: 12, borderRadius: 8, border: "1px solid var(--line)", margin: 0 }}>
              {latest.body}
            </pre>
          </div>
        </Card>

        <Card title="Version history" padding>
          {history.length <= 1 ? (
            <EmptyState icon="🗂" title="No earlier versions" message="This template has only one version." />
          ) : (
            <DataTable<VersionRow>
              columns={[
                { key: "version", label: "Version", align: "right" },
                { key: "channel", label: "Channel" },
                { key: "subject", label: "Subject" },
                { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
              ]}
              rows={history}
              sortable
              pageSize={10}
            />
          )}
        </Card>
      </div>
    </>
  );
}
