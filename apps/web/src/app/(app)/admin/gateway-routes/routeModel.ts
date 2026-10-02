/**
 * Route-catalogue row mapping for /admin/gateway-routes.
 * Fields mirror gateway-service catalogue.api_entry (name, module, version,
 * path, method, upstream, owner, status, updatedAt).
 * GAP-ADMIN-GATEWAY-ROUTES-02/03.
 */
import { formatIndianDateTime } from "@/lib/formatters";

export type GatewayRouteRow = {
  id: string;
  name: string;
  module: string;
  method: string;
  path: string;
  upstream: string;
  status: string;
  /** Pre-formatted ("16 Jan 2024, 12:30 am"), or an em dash. */
  updated: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function extractRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data;
  return [];
}

export function mapGatewayRoutes(payload: unknown): GatewayRouteRow[] {
  const out: GatewayRouteRow[] = [];
  for (const row of extractRows(payload)) {
    if (!isRecord(row)) continue;
    const method = text(row.method).toUpperCase();
    const path = text(row.path);
    const updatedAt = text(row.updatedAt);
    out.push({
      // The full id is kept for the React key only -- it is never shown.
      id: text(row.id) || `${method} ${path} ${text(row.name)}`,
      name: text(row.name),
      module: text(row.module),
      method,
      path,
      upstream: text(row.upstream),
      status: text(row.status),
      updated: updatedAt === "" ? "—" : Number.isNaN(Date.parse(updatedAt)) ? updatedAt : formatIndianDateTime(updatedAt),
    });
  }
  return out;
}
