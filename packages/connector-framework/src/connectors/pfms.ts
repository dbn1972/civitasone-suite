import {
  initiateDisbursement,
  checkDisbursementStatus,
  type PfmsDisbursementRequest,
  type PfmsStatusRequest,
} from "@civitasone/gov-adapters/pfms";
import { BaseConnector } from "../base.js";
import { ConnectorError } from "../types.js";

/**
 * PFMS connector — adapts the gov-adapters PFMS disbursement functions to the
 * uniform Connector contract. Enriches each disbursement with the tenant's
 * registered scheme code (from injected config) when the caller omits it.
 */
export class PfmsConnector extends BaseConnector {
  readonly provider = "pfms";
  readonly requiredSecrets = ["authToken"] as const;
  readonly operations = ["initiateDisbursement", "checkDisbursementStatus"] as const;

  private defaultSchemeCode(): string | undefined {
    const s = this.cfg.config.schemeCode;
    return typeof s === "string" && s.length > 0 ? s : undefined;
  }

  async invoke<TOut = unknown>(operation: string, input?: unknown): Promise<TOut> {
    this.assertOperation(operation);
    if (this.mode !== "mock") this.assertReady();

    switch (operation) {
      case "initiateDisbursement": {
        const req = input as PfmsDisbursementRequest;
        const schemeCode = req.schemeCode || this.defaultSchemeCode();
        if (!schemeCode) throw new ConnectorError("BAD_INPUT", "initiateDisbursement requires a schemeCode");
        return (await initiateDisbursement({ ...req, schemeCode })) as TOut;
      }
      case "checkDisbursementStatus": {
        const req = input as PfmsStatusRequest;
        if (!req?.pfmsTxnId) throw new ConnectorError("BAD_INPUT", "checkDisbursementStatus requires pfmsTxnId");
        return (await checkDisbursementStatus(req)) as TOut;
      }
      default:
        throw new ConnectorError("UNKNOWN_OPERATION", operation);
    }
  }
}

export function pfmsConnectorFactory(): PfmsConnector {
  return new PfmsConnector();
}
