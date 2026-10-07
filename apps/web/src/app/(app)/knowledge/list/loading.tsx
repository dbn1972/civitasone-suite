/** GAP-KNOWLEDGE-HOME-05: see knowledge/loading.tsx — same dark-mode + scroll fix. */
export default function KnowledgeListLoading() {
  return (
    <div style={{ background: "var(--bg, #f8fafc)", padding: "24px 32px" }}>
      <div className="mx-auto max-w-7xl animate-pulse space-y-5">
        <div className="h-4 w-44 rounded" style={{ background: "var(--line, #e2e8f0)" }} />
        <div className="h-9 w-80 rounded" style={{ background: "var(--line, #e2e8f0)" }} />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl" style={{ background: "var(--line, #e2e8f0)" }} />
          ))}
        </div>
        <div className="h-72 rounded-xl" style={{ background: "var(--line, #e2e8f0)" }} />
      </div>
    </div>
  );
}
