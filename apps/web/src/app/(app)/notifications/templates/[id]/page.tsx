"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button, PageHeader, Card, DataTable, EmptyState } from "../../../../_components/ds";
import { StatusBadge } from "../../_components/StatusBadge";
import { channelLabel } from "../../_components/channelLabel";
import { formatIndianDateTime } from "@/lib/formatters";
import { useFormError } from "@/lib/useFormError";

/**
 * Template detail — backed by GET /notification/templates/:id/versions, which
 * returns the template's version history. The server builds the chain from the
 * supersededBy links; its order is NOT relied upon here — the current version
 * is picked by MAX(version) and the history table is sorted version-desc
 * (GAP-NOTIFICATIONS-TEMPLATES-DETAIL-02). A superseded template disables the
 * send CTA and links to its replacement (DETAIL-03).
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
  createdAt?: string | null;
  createdBy?: string | null;
};

type VersionRow = {
  version: number;
  status: string;
  channel: string;
  subject: string;
  updated: string;
  author: string;
  current: string;
} & Record<string, unknown>;

function toArray(raw: unknown): TemplateView[] {
  if (Array.isArray(raw)) return raw as TemplateView[];
  if (raw && typeof raw === "object") {
    const rec = raw as Record<string, unknown>;
    if (Array.isArray(rec.data)) return rec.data as TemplateView[];
  }
  return [];
}

function shortActor(id: string | null | undefined): string {
  if (!id) return "—";
  return id.length > 8 ? id.slice(0, 8) : id;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
      <span style={{ fontSize: 12, color: "var(--muted, #667085)" }}>{label}</span>
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
  const formError = useFormError("template");

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
        if (!res.ok) {
          const resolved = await formError.fromResponse(res, "load");
          setError(resolved.message);
          return;
        }
        setVersions(toArray(await res.json()));
      } catch (caught) {
        setError(formError.fromException("load", caught).message);
      } finally {
        setLoading(false);
      }
    })();
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- formError methods are stable; see useFormError.
  useEffect(load, [id]);

  if (loading) {
    return (
      <>
        <PageHeader title="Template" subtitle="Loading template…" back="/notifications/templates" />
        <Card padding>
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted, #667085)" }}>Loading template…</p>
        </Card>
      </>
    );
  }

  // GAP-NOTIFICATIONS-TEMPLATES-DETAIL-02: the current version is the highest
  // version number, regardless of the order the API returned the chain in.
  const sortedDesc = [...versions].sort((a, b) => b.version - a.version);
  const latest = sortedDesc[0];

  if (error || !latest) {
    return (
      <>
        <PageHeader title="Template" back="/notifications/templates" />
        <Card padding>
          <EmptyState
            icon="📭"
            title={error ? "Couldn't load this template" : "Template not found"}
            // GAP-NOTIFICATIONS-TEMPLATES-DETAIL-05: surface the resolved,
            // clerk-safe error message instead of a fixed sentence.
            message={error ?? "This template does not exist or is not visible to your tenant."}
            action={
              error ? (
                <Button onClick={load}>Try again</Button>
              ) : (
                <Link className="btn ghost" href="/notifications/templates">Back to templates</Link>
              )
            }
          />
        </Card>
      </>
    );
  }

  // GAP-NOTIFICATIONS-TEMPLATES-DETAIL-03: a superseded current version must not
  // offer a plain "Send" — it would send retired wording.
  const isSuperseded = Boolean(latest.supersededBy) || latest.status === "superseded";

  const history: VersionRow[] = sortedDesc.map((v) => ({
    version: v.version,
    status: v.supersededBy ? "superseded" : v.status,
    channel: channelLabel(v.channel),
    subject: v.subject ?? "—",
    updated: formatIndianDateTime(v.createdAt ?? null),
    author: shortActor(v.createdBy),
    current: v.id === latest.id ? "Current" : "",
  }));

  return (
    <>
      <PageHeader
        title={latest.name}
        subtitle="Template content and version history."
        back="/notifications/templates"
        actions={
          isSuperseded ? (
            <Button disabled aria-disabled="true" title="This version is superseded">Send with this template</Button>
          ) : (
            // GAP-NOTIFICATIONS-TEMPLATES-DETAIL-01: carry the template id into compose.
            <Link className="btn primary" href={`/notifications/compose?templateId=${latest.id}`}>Send with this template</Link>
          )
        }
      />

      {isSuperseded ? (
        <div role="alert" className="card" style={{ borderColor: "var(--warnline, var(--line))", padding: 12, margin: "12px 0" }}>
          This template version is superseded and should not be sent.{" "}
          {latest.supersededBy ? (
            <Link href={`/notifications/templates/${latest.supersededBy}`}>Open the current version →</Link>
          ) : null}
        </div>
      ) : null}

      <div className="grid g-main" style={{ marginTop: 18 }}>
        <Card title="Current version" padding>
          <Row label="Status"><StatusBadge status={isSuperseded ? "superseded" : latest.status} /></Row>
          <Row label="Channel">{channelLabel(latest.channel)}</Row>
          <Row label="Version">{latest.version}</Row>
          <Row label="Subject">{latest.subject ?? "—"}</Row>
          <Row label="Last updated">{formatIndianDateTime(latest.createdAt ?? null)}</Row>
          <Row label="Author">{shortActor(latest.createdBy)}</Row>
          <div style={{ paddingTop: 12 }}>
            <div style={{ fontSize: 12, color: "var(--muted, #667085)", marginBottom: 4 }}>Body</div>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, background: "var(--bg, #f8fafc)", color: "var(--fg, inherit)", padding: 12, borderRadius: 8, border: "1px solid var(--line)", margin: 0 }}>
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
                { key: "current", label: "" },
                { key: "channel", label: "Channel" },
                { key: "subject", label: "Subject" },
                { key: "updated", label: "Updated" },
                { key: "author", label: "Author" },
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
