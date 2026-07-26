import {
  fileGstr1,
  fileGstr3B,
  checkFilingStatus,
  type Gstr1Request,
  type Gstr3BRequest,
} from "@civitasone/gov-adapters/gstn";
import { BaseConnector } from "../base.js";
import { ConnectorError } from "../types.js";

/**
 * GSTN connector — adapts the gov-adapters GSTN filing functions to the uniform
 * Connector contract. The framework owns discovery, per-tenant config
 * resolution, health, and dispatch; the connector enriches each request with
 * the tenant's registered GSTIN (from injected config) before delegating.
 */
export class GstnConnector extends BaseConnector {
  readonly provider = "gstn";
  readonly requiredSecrets = ["clientId", "clientSecret"] as const;
  readonly operations = ["fileGstr1", "fileGstr3B", "checkFilingStatus"] as const;

  private gstin(): string | undefined {
    const g = this.cfg.config.gstin;
    return typeof g === "string" && g.length > 0 ? g : undefined;
  }

  async invoke<TOut = unknown>(operation: string, input?: unknown): Promise<TOut> {
    this.assertOperation(operation);
    if (this.mode !== "mock") this.assertReady();

    switch (operation) {
      case "fileGstr1": {
        const req = input as Gstr1Request;
        const gstin = req.gstin ?? this.gstin();
        return (await fileGstr1({ ...req, ...(gstin ? { gstin } : {}) })) as TOut;
      }
      case "fileGstr3B": {
        const req = input as Gstr3BRequest;
        const gstin = req.gstin ?? this.gstin();
        return (await fileGstr3B({ ...req, ...(gstin ? { gstin } : {}) })) as TOut;
      }
      case "checkFilingStatus": {
        const referenceId = typeof input === "string" ? input : (input as { referenceId: string }).referenceId;
        if (!referenceId) throw new ConnectorError("BAD_INPUT", "checkFilingStatus requires a referenceId");
        return (await checkFilingStatus(referenceId)) as TOut;
      }
      default:
        throw new ConnectorError("UNKNOWN_OPERATION", operation);
    }
  }
}

export function gstnConnectorFactory(): GstnConnector {
  return new GstnConnector();
}
