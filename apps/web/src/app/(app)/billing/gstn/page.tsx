import { PageHeader, Card } from "../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";
import { GstnConsole } from "./GstnConsole";

interface GstnStatus {
  enabled: boolean;
  breaker: "closed" | "open" | "half-open";
}

async function getGstnStatus(): Promise<GstnStatus | null> {
  const { data, source } = await fetchJson<unknown, GstnStatus | null>("/api/v1/billing/gstn/status", null, {
    telemetryKey: "billing.gstn.status",
    mapResponse: (p) => {
      const d = (p as { data?: GstnStatus })?.data ?? (p as GstnStatus);
      return d && typeof d.enabled === "boolean" ? d : null;
    },
  });
  return source === "api" ? data : null;
}

export default async function GstnConsolePage() {
  const status = await getGstnStatus();
  // GAP-BILLING-GSTN-08: when we can positively determine GSTN is off, say so
  // and disable the forms, instead of the old "may be disabled" hedge that the
  // user could only resolve by failing a call. When the status itself can't be
  // read (null), fall back to allowing the forms (the backend still fails
  // closed with INTEGRATION_DISABLED, surfaced as a clear message).
  const enabled = status ? status.enabled : true;
  const breakerOpen = status?.breaker === "open";

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="GSTN Console"
        subtitle="Submit GST returns, check filing status, and verify GSTINs against the Goods and Services Tax Network. Actions call an external government system."
        back="/billing"
      />

      {!enabled && (
        <div role="status" className="pill warn" style={{ width: "fit-content", marginBottom: 12 }}>
          GSTN is disabled in this environment. Filing and verification are unavailable.
        </div>
      )}
      {enabled && breakerOpen && (
        <div role="status" className="pill warn" style={{ width: "fit-content", marginBottom: 12 }}>
          GSTN is temporarily unreachable (service protection active). Try again shortly.
        </div>
      )}

      <Card title="GSTN Actions" padding>
        <GstnConsole gstnEnabled={enabled} />
      </Card>
    </div>
  );
}
