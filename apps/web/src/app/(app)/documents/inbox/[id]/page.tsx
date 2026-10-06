import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, RefreshErrorState } from "../../../../_components/ds";
import { getDak } from "../../_data/loaders";
import { formatIndianDate, formatInternalRef, humanizeStatus } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { DakActions } from "../DakActions";

export default async function DakDetailPage({ params }: { params: { id: string } }) {
  const { data: dak, source, status } = await getDak(params.id);

  // A real "not found" (the row doesn't exist) is a 404 page; any other
  // failure is a transient load error with a retry, never a 404.
  if (source === "error" && status === 404) notFound();
  if (source === "error") {
    return (
      <div className="wrap">
        <PageHeader title="Dak" subtitle="e-Office inbox item." />
        <div className="card" style={{ marginTop: 18 }}>
          <RefreshErrorState error={toHumanError("load", { area: "this dak" })} />
        </div>
      </div>
    );
  }
  if (!dak) notFound();

  return (
    <div className="wrap">
      <PageHeader
        title={dak.subject}
        subtitle={`Reference ${formatInternalRef(dak.id)}`}
        actions={<Link href="/documents/inbox" className="btn">Back to Inbox</Link>}
      />

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Details</h3></div>
        <div style={{ padding: "16px 24px", display: "grid", gap: 12 }}>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px", margin: 0 }}>
            <dt style={{ color: "var(--ink2)" }}>Priority</dt>
            <dd style={{ margin: 0 }}>{humanizeStatus(dak.priority)}</dd>
            <dt style={{ color: "var(--ink2)" }}>Status</dt>
            <dd style={{ margin: 0 }}>{humanizeStatus(dak.status)}</dd>
            <dt style={{ color: "var(--ink2)" }}>Due</dt>
            <dd style={{ margin: 0 }}>{formatIndianDate(dak.dueDate)}</dd>
            <dt style={{ color: "var(--ink2)" }}>Created</dt>
            <dd style={{ margin: 0 }}>{formatIndianDate(dak.createdAt)}</dd>
          </dl>
          {dak.body && <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{dak.body}</p>}
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Actions</h3></div>
        <div style={{ padding: "16px 24px" }}>
          <DakActions dakId={dak.id} status={dak.status} />
        </div>
      </div>
    </div>
  );
}
