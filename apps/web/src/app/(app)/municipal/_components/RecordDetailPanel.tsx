import { Card, StatusPill, Masked } from "@/app/_components/ds";
import { detailEntries } from "../_data/records";
import type { MunicipalServiceConfig } from "../_data/services";

type Props = {
  record: Record<string, unknown>;
  config: MunicipalServiceConfig;
  title: string;
  reference: string;
  status: string;
};

export function RecordDetailPanel({ record, config, title, reference, status }: Props) {
  const entries = detailEntries(record, config);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card padding>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{reference}</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{title}</h2>
          </div>
          <StatusPill status={status} />
        </div>
        {/* GAP-...-DETAIL-02 / DETAIL-04: removed the developer "read-only view
            loaded from the municipal service API" sentence and the "actions …
            will wire to workflow tasks in a follow-up pass" roadmap text — both
            were developer-facing copy reaching officers. Officer workflow
            actions (approve/reject/inspect/issue) and a history timeline are
            not wired here because no workflow task API exists for these
            generic municipal services in this snapshot (see HUMAN REVIEW). */}
        <p style={{ fontSize: 13, color: "var(--ink2)", margin: 0 }}>
          Read-only record. Sensitive personal details are masked.
        </p>
      </Card>

      <Card title="Record details">
        <div className="pad" style={{ display: "grid", gap: 12 }}>
          {entries.map((entry) => (
            <div
              key={entry.key}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(140px, 220px) 1fr",
                gap: 12,
                alignItems: "start",
                borderBottom: "1px solid var(--line)",
                paddingBottom: 10,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 650, color: "var(--ink2)" }}>{entry.label}</div>
              {entry.kind === "pii" && entry.piiKind ? (
                <Masked
                  value={entry.rawValue}
                  kind={entry.piiKind}
                  ariaLabel={`${entry.label} (masked)`}
                />
              ) : (
                <pre
                  style={{
                    margin: 0,
                    fontFamily: "inherit",
                    fontSize: 13,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {entry.value}
                </pre>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
