"use client";

import Link from "next/link";
import type { ServiceDefinitionDto } from "@/app/(app)/designer/_data/designerApi";

export interface VersionDiffProps {
  current: ServiceDefinitionDto;
  published: Record<string, unknown> | null;
}

interface DiffRow {
  label: string;
  before: string;
  after: string;
}

function fmtMoney(code: string | null | undefined): string {
  if (!code) return "—";
  return `HOA ${code}`;
}

function buildDiffRows(current: ServiceDefinitionDto, published: Record<string, unknown> | null): DiffRow[] {
  if (!published) {
    return [{ label: "Version", before: "—", after: "First version (nothing published yet)" }];
  }

  const rows: DiffRow[] = [];
  const pubName = String(published.name ?? "");
  if (pubName !== current.name) {
    rows.push({ label: "Service name", before: pubName, after: current.name });
  }

  const pubSla = published.slaDays == null ? "—" : String(published.slaDays);
  const curSla = current.slaDays == null ? "—" : String(current.slaDays);
  if (pubSla !== curSla) {
    rows.push({ label: "SLA (days)", before: pubSla, after: curSla });
  }

  const pubHoa = published.hoaCode == null ? null : String(published.hoaCode);
  if (pubHoa !== (current.hoaCode ?? null)) {
    rows.push({
      label: "Head of Account",
      before: fmtMoney(pubHoa),
      after: fmtMoney(current.hoaCode),
    });
  }

  const pubFee = published.feeModel == null ? "—" : String(published.feeModel);
  const curFee = current.feeModel ?? "—";
  if (pubFee !== curFee) {
    rows.push({ label: "Fee model", before: pubFee, after: curFee });
  }

  const pubChannels = Array.isArray(published.channels) ? (published.channels as string[]).join(", ") : "—";
  const curChannels = current.channels.join(", ");
  if (pubChannels !== curChannels) {
    rows.push({ label: "Channels", before: pubChannels, after: curChannels });
  }

  const pubDocs = Array.isArray(published.requiredDocuments) ? (published.requiredDocuments as unknown[]).length : 0;
  const curDocs = current.requiredDocuments?.length ?? 0;
  if (pubDocs !== curDocs) {
    rows.push({
      label: "Required documents",
      before: `${pubDocs} document(s)`,
      after: `${curDocs} document(s)`,
    });
  }

  if (rows.length === 0) {
    rows.push({ label: "Changes", before: "—", after: "No field-level differences detected from published version." });
  }

  return rows;
}

export function VersionDiff({ current, published }: VersionDiffProps) {
  const rows = buildDiffRows(current, published);

  return (
    <div>
      <h3 style={{ margin: "0 0 12px", fontSize: 16, color: "var(--ink)" }}>Changes from published version</h3>
      {!published ? (
        <p style={{ color: "var(--mut)", marginTop: 0 }}>This is the first version — nothing is live yet.</p>
      ) : null}
      <div style={{ display: "grid", gap: 8 }}>
        {rows.map((row) => (
          <div
            key={row.label}
            style={{
              display: "grid",
              gridTemplateColumns: "160px 1fr 1fr",
              gap: 12,
              padding: "10px 12px",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-sm)",
              background: "var(--panel)",
              fontSize: 13,
            }}
          >
            <span style={{ fontWeight: 600, color: "var(--ink2)" }}>{row.label}</span>
            <span style={{ color: "var(--mut)" }}>{row.before}</span>
            <span style={{ color: "var(--ink)" }}>{row.after}</span>
          </div>
        ))}
      </div>
      <p style={{ marginTop: 12, fontSize: 12, color: "var(--mut)" }}>
        <Link href={`/designer/${current.id}/b1`}>Open read-only wizard walkthrough</Link>
      </p>
    </div>
  );
}
