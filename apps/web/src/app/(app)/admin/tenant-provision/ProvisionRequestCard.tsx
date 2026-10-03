import Link from "next/link";
import { Card, LoadErrorState, StatusPill } from "@/app/_components/ds";
import type { LoaderResult } from "@/app/_data/apiClient";
import { onboardingStageTone } from "../onboarding/onboardingStats";

/** One onboarding request as the API returns it (contact already masked). */
export type OnboardingRequestDetail = {
  id: string;
  org: string;
  contact: string;
  requested: string;
  assigned: string;
  stage: string;
};
export type ProvisionRequestResult = LoaderResult<OnboardingRequestDetail | null>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A request id from the query string, or null when absent / not a UUID (never sent to the API). */
export function parseRequestId(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && UUID.test(s) ? s : null;
}

/**
 * GAP-ADMIN-ONBOARDING-07: the onboarding request this provisioning visit is for, so the
 * operator sees whose tenant they are setting up. The contact arrives already masked.
 * Loading failure, "no such request" and a 403 are three different states.
 */
export function ProvisionRequestCard({ result }: { result: ProvisionRequestResult }) {
  if (result.source === "error" && result.status !== 404) {
    return (
      <Card title="Onboarding request">
        <LoadErrorState result={result} area="onboarding request" backHref="/admin/onboarding" backLabel="Back to the queue" />
      </Card>
    );
  }
  const r = result.data;
  if (!r || result.status === 404) {
    return (
      <Card title="Onboarding request">
        <p role="status" style={{ margin: 0, fontSize: 13 }}>
          That onboarding request was not found. It may have been removed, or the link is out of date.{" "}
          <Link href="/admin/onboarding">Back to the onboarding queue</Link>
        </p>
      </Card>
    );
  }
  return (
    <Card title="Onboarding request">
      <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 16px", margin: 0, fontSize: 13 }}>
        <dt>Organisation</dt><dd style={{ margin: 0 }}>{r.org}</dd>
        <dt>Contact</dt><dd style={{ margin: 0 }}>{r.contact || "—"}</dd>
        <dt>Requested</dt><dd style={{ margin: 0 }}>{r.requested || "—"}</dd>
        <dt>Assigned to</dt><dd style={{ margin: 0 }}>{r.assigned || "Unassigned"}</dd>
        <dt>Stage</dt><dd style={{ margin: 0 }}><StatusPill status={r.stage} variant={onboardingStageTone(r.stage)} /></dd>
      </dl>
    </Card>
  );
}
