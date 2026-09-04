import { Card, StatusPill } from "@/app/_components/ds";
import { detailEntries } from "../_data/records";

type Props = {
  record: Record<string, unknown>;
  title: string;
  reference: string;
  status: string;
};

export function RecordDetailPanel({ record, title, reference, status }: Props) {
  const entries = detailEntries(record);

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
        <p style={{ fontSize: 13, color: "var(--ink2)", margin: 0 }}>
          Read-only view loaded from the municipal service API. Actions (approve, inspect, issue) will
          wire to workflow tasks in a follow-up pass.
        </p>
      </Card>

      <Card title="Record details">
        <div className="pad" style={{ display: "grid", gap: 12 }}>
          {entries.map(({ label, value }) => (
            <div
              key={label}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(140px, 220px) 1fr",
                gap: 12,
                alignItems: "start",
                borderBottom: "1px solid var(--line)",
                paddingBottom: 10,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 650, color: "var(--ink2)" }}>{label}</div>
              <pre
                style={{
                  margin: 0,
                  fontFamily: "inherit",
                  fontSize: 13,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {value}
              </pre>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
