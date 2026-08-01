import { Card, EmptyState } from "../../../_components/ds";
import type { PfmsConfig } from "./types";

/**
 * Read-only — GET /v1/finance/pfms/config. finance-service does not register a
 * POST/PUT route to set this configuration (see PR "## BACKEND FOLLOW-UPS");
 * agency code / default DDO must be provisioned by an administrator directly.
 */
export function ConfigPanel({ config }: { config: PfmsConfig | null }) {
  if (!config || (!config.agencyCode && !config.defaultDdo)) {
    return (
      <EmptyState
        icon="⚙️"
        title="No PFMS configuration set"
        message="This tenant has no PFMS agency code or default DDO configured. The finance-service does not currently expose a way to set this from the UI — it must be provisioned by an administrator."
      />
    );
  }

  return (
    <Card title="PFMS Configuration" padding>
      <div className="fields">
        <div className="fld">
          <div className="l">Agency Code</div>
          <div className="v">{config.agencyCode ?? "—"}</div>
        </div>
        <div className="fld">
          <div className="l">Default DDO</div>
          <div className="v">{config.defaultDdo ?? "—"}</div>
        </div>
      </div>
    </Card>
  );
}
