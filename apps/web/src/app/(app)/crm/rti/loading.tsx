import { PageHeader } from "../../../_components/ds";

export default function RtiLoading() {
  return (
    <>
      <PageHeader
        title="RTI Requests"
        subtitle="Right to Information Act 2005 — 30-day response register."
        back="/crm"
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{
              height: 72,
              borderRadius: "var(--r)",
              background: "var(--panel)",
              border: "1px solid var(--line)",
              animation: "pulse 1.4s ease-in-out infinite",
            }}
          />
        ))}
      </div>
      <div
        style={{
          height: 320,
          borderRadius: "var(--r)",
          background: "var(--panel)",
          border: "1px solid var(--line)",
          animation: "pulse 1.4s ease-in-out infinite",
        }}
      />
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.5; }
        }
      `}</style>
    </>
  );
}
