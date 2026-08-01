import { PageHeader } from "@/app/_components/ds";
import { CondemnationWorkflow } from "./CondemnationWorkflow";

/**
 * Condemnation, Auction & Disposal workflow (SVC-060).
 *
 * asset-service's condemnation module exposes ONLY command endpoints
 * (POST/PATCH, all 202-accepted, fire-and-forget to the outbox) — there is no
 * GET for a survey, recommendation, or auction by id, and no list. See
 * services/asset-service/src/modules/condemnation/routes.ts. That means this
 * screen cannot pre-fetch a record to confirm it exists before acting; each
 * step below is a plain command form that carries the id returned by the
 * previous step forward in local state (or accepts a manually-entered id when
 * resuming a workflow started elsewhere). Maker-checker on recommendation
 * approval is enforced server-side, asynchronously, in the consumer
 * (assertMakerChecker) — the UI cannot know in advance whether an approval
 * will be accepted, so on success we report "submitted", never "approved".
 */
export default function CondemnationPage() {
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Condemnation, Auction & Disposal"
        subtitle="Survey a condemned asset, record the committee's recommendation, and run the disposal auction."
        back="/assets"
        backLabel="Assets"
      />
      <CondemnationWorkflow />
    </main>
  );
}
