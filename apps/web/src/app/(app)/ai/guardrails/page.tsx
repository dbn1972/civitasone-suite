import { Card, PageHeader, RefreshErrorState } from "../../../_components/ds";
import { getAiGuardrailRules } from "../_data";
import { toHumanError } from "@/lib/messages";
import { GuardrailRulesTable } from "./GuardrailRulesTable";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getAiGuardrailRules();
  const errored = source === "error";

  return (
    <div className="page-main" aria-labelledby="page-heading">
      {/* GAP-AI-GUARDRAILS-05: client-side back via PageHeader, not a plain <a>.
          GAP-AI-GUARDRAILS-04: a link to the blocked-prompt audit trail. */}
      <PageHeader
        title="AI — Guardrails"
        subtitle="Safety policies and content-filtering rules evaluated on every AI prompt."
        back="/ai"
        backLabel="AI & Copilot"
        actions={<a className="btn" href="/ai/governance?blocked=true">View blocked prompts</a>}
      />
      <Card title="Guardrail Rules">
        {errored ? (
          // GAP-AI-GUARDRAILS-01: a failed fetch is a retryable error, not
          // "no safety rules in force".
          <RefreshErrorState
            error={toHumanError("load", { area: "guardrail rules" })}
            source={{ area: "guardrail rules" }}
          />
        ) : (
          <GuardrailRulesTable rules={data} />
        )}
      </Card>
    </div>
  );
}
