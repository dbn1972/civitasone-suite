/**
 * @civitasone/connector-framework — CAP-053 reusable connector/adapter framework.
 *
 * A common Connector contract + a registry + config-driven instantiation from
 * the admin-service integration_settings registry. Two existing gov-adapters
 * (GSTN, PFMS) are refactored to implement the contract as proof.
 */
export * from "./types.js";
export { BaseConnector } from "./base.js";
export {
  registerConnector,
  getConnectorFactory,
  listConnectorProviders,
  createConnector,
  createConfiguredConnector,
  type ConnectorFactory,
  type ConfiguredConnectorOpts,
} from "./registry.js";

export { GstnConnector, gstnConnectorFactory } from "./connectors/gstn.js";
export { PfmsConnector, pfmsConnectorFactory } from "./connectors/pfms.js";

import { registerConnector } from "./registry.js";
import { gstnConnectorFactory } from "./connectors/gstn.js";
import { pfmsConnectorFactory } from "./connectors/pfms.js";

/** Register the built-in connectors. Idempotent; called once on import. */
export function registerBuiltInConnectors(): void {
  registerConnector("gstn", gstnConnectorFactory);
  registerConnector("pfms", pfmsConnectorFactory);
}

registerBuiltInConnectors();
