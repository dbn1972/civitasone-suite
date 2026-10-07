import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { getKnowledgeFaqs, getKnowledgeGuidedFlows } from "../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { FaqBrowser } from "./FaqBrowser";

// GAP-KNOWLEDGE-FAQS-01: stat cards show "—" on error, not misleading 0.
// GAP-KNOWLEDGE-FAQS-05: null category → "General" for display and counting.
// GAP-KNOWLEDGE-FAQS-03: client-side FaqBrowser component with search + category filter.
export default async function Page() {
  const [{ data: faqs, source: faqsSource }, { data: flows, source: flowsSource }] = await Promise.all([
    getKnowledgeFaqs(),
    getKnowledgeGuidedFlows(),
  ]);
  const source = faqsSource === "error" || flowsSource === "error" ? "error" : "api";
  const errored = source === "error";

  // GAP-KNOWLEDGE-FAQS-05: normalise null category to "General"
  const normalisedFaqs = faqs.map((f) => ({ ...f, category: f.category ?? "General" }));
  const categories = new Set(normalisedFaqs.map((f) => f.category));

  return (
    <>
      <PageHeader
        title="FAQ & Guided Support"
        subtitle="Browse frequently asked questions and step-by-step guided flows."
        back="/knowledge"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        {/* GAP-KNOWLEDGE-FAQS-01: pass "—" when errored */}
        <StatCard icon="❓" iconBg="#eef2ff" label="FAQs" value={errored ? "—" : faqs.length.toLocaleString("en-IN")} />
        <StatCard icon="🗂️" iconBg="#ecfdf5" label="Categories" value={errored ? "—" : categories.size.toLocaleString("en-IN")} />
        <StatCard icon="🧭" iconBg="#fffbeb" label="Guided flows" value={errored ? "—" : flows.length.toLocaleString("en-IN")} />
      </StatGrid>

      {errored ? (
        <RefreshErrorState error={toHumanError("load", { area: "FAQs and guided flows" })} backHref="/knowledge" />
      ) : (
        <>
          <div className="card">
            <div className="card-h"><h3>Frequently asked questions</h3></div>
            {normalisedFaqs.length === 0 ? (
              <EmptyState icon="❓" title="No FAQs yet" message="Published FAQs will appear here for staff to browse." />
            ) : (
              <FaqBrowser faqs={normalisedFaqs} />
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
                    {flow.description && <p style={{ margin: "0 0 8px", color: "var(--mut)", fontSize: 13 }}>{flow.description}</p>}
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
      )}
    </>
  );
}
