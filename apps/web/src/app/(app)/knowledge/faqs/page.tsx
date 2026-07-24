import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, EmptyState } from "../../../_components/ds";
import { getKnowledgeFaqs, getKnowledgeGuidedFlows } from "../_data/loaders";

export default async function Page() {
  const [{ data: faqs, source }, { data: flows }] = await Promise.all([
    getKnowledgeFaqs(),
    getKnowledgeGuidedFlows(),
  ]);

  const categories = new Set(faqs.map((f) => f.category ?? "general"));

  return (
    <>
      <PageHeader
        title="FAQ & Guided Support"
        subtitle="Browse frequently asked questions and step-by-step guided flows."
        back="/knowledge"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="❓" iconBg="#eef2ff" label="FAQs" value={faqs.length.toLocaleString("en-IN")} />
        <StatCard icon="🗂️" iconBg="#ecfdf5" label="Categories" value={categories.size.toLocaleString("en-IN")} />
        <StatCard icon="🧭" iconBg="#fffbeb" label="Guided flows" value={flows.length.toLocaleString("en-IN")} />
      </StatGrid>

      <div className="card">
        <div className="card-h"><h3>Frequently asked questions</h3></div>
        {faqs.length === 0 ? (
          <EmptyState icon="❓" title="No FAQs yet" message="Published FAQs will appear here for staff to browse." />
        ) : (
          <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {faqs.map((f) => (
              <details key={f.id} style={{ border: "1px solid var(--line, #e2e8f0)", borderRadius: 10, padding: "12px 14px" }}>
                <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--ink, #0f172a)" }}>
                  {f.question}
                  {f.category && <span style={{ marginLeft: 8, fontSize: 12, color: "var(--ink3, #94a3b8)" }}>· {f.category}</span>}
                </summary>
                <p style={{ marginTop: 8, marginBottom: 0, lineHeight: 1.6, color: "var(--ink2, #475569)", whiteSpace: "pre-wrap" }}>{f.answer}</p>
              </details>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-h"><h3>Guided support flows</h3></div>
        {flows.length === 0 ? (
          <EmptyState icon="🧭" title="No guided flows yet" message="Ordered step-by-step guides will appear here." />
        ) : (
          <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {flows.map((flow) => (
              <div key={flow.id}>
                <h4 style={{ margin: "0 0 4px" }}>{flow.title}</h4>
                {flow.description && <p style={{ margin: "0 0 8px", color: "var(--ink3, #94a3b8)", fontSize: 13 }}>{flow.description}</p>}
                <ol style={{ margin: 0, paddingLeft: 20 }}>
                  {flow.steps.map((s) => (
                    <li key={s.order} style={{ padding: "3px 0", lineHeight: 1.5 }}>
                      <strong>{s.title}</strong> — <span style={{ color: "var(--ink2, #475569)" }}>{s.instruction}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
