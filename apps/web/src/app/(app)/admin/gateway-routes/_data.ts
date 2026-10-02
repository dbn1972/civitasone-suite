/**
 * gateway route-catalogue server loader.
 * Calls gateway-service through the gateway via cookie-aware fetchJson.
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { mapGatewayRoutes, type GatewayRouteRow } from "./routeModel";

export function getGatewayCatalogue(): Promise<LoaderResult<GatewayRouteRow[]>> {
  return fetchJson<unknown, GatewayRouteRow[]>("/api/v1/gateway/catalogue", [], {
    revalidateSeconds: 30,
    telemetryKey: "gateway.catalogue",
    mapResponse: mapGatewayRoutes,
  });
}
