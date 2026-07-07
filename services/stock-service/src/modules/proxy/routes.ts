/**
 * proxy module — deprecation proxy routes that forward stock-service requests
 * to the canonical inventory-service endpoints.
 *
 * Part of the stock-service / inventory-service unification (Req 14.1).
 *
 * These routes are registered when INVENTORY_PROXY_ENABLED=true. They provide
 * inventory-style paths (/v1/inventory/*) on the stock-service port so that
 * clients can begin migrating to the canonical model while stock-service is
 * still running. All native /v1/stock/* routes continue to work with the
 * Deprecation header added via the onSend hook below.
 *
 * Once migration is complete, clients should point directly to inventory-service
 * at port 3025 and stock-service can be decommissioned.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { resolveContext, HttpError } from "../../shared/context.js";

const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL ?? "http://localhost:3025";

/** Header indicating routes are deprecated in favor of inventory-service. */
const DEPRECATION_HEADER = "Deprecation";
const DEPRECATION_VALUE = "true";
const SUNSET_HEADER = "Sunset";
const LINK_HEADER = "Link";

/**
 * Proxy routes at /v1/inventory/* paths served by stock-service port.
 * Forwards to the canonical inventory-service.
 */
const PROXY_ROUTES: Array<{ method: "GET" | "POST" | "PATCH"; path: string }> = [
  { method: "GET",   path: "/v1/inventory/items" },
  { method: "GET",   path: "/v1/inventory/items/:id" },
  { method: "POST",  path: "/v1/inventory/items" },
  { method: "GET",   path: "/v1/inventory/categories" },
  { method: "GET",   path: "/v1/inventory/uoms" },
  { method: "POST",  path: "/v1/inventory/warehouses" },
  { method: "PATCH", path: "/v1/inventory/warehouses/:id" },
  { method: "GET",   path: "/v1/inventory/warehouses" },
  { method: "GET",   path: "/v1/inventory/warehouses/:id" },
  { method: "POST",  path: "/v1/inventory/receipts" },
  { method: "POST",  path: "/v1/inventory/issues" },
  { method: "POST",  path: "/v1/inventory/transfers" },
  { method: "POST",  path: "/v1/inventory/adjustments" },
  { method: "GET",   path: "/v1/inventory/balances" },
  { method: "GET",   path: "/v1/inventory/ledger" },
  { method: "GET",   path: "/v1/inventory/stores" },
];

async function forwardToInventory(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  resolveContext(req);

  // Resolve target URL replacing path params
  let resolvedPath = req.url.split("?")[0]!;
  const queryString = req.url.includes("?") ? req.url.split("?")[1] : "";
  const targetUrl = `${INVENTORY_SERVICE_URL}${resolvedPath}${queryString ? `?${queryString}` : ""}`;

  // Forward headers (auth, tenant, correlation)
  const forwardHeaders: Record<string, string> = {
    "content-type": "application/json",
  };
  if (req.headers.authorization) forwardHeaders.authorization = req.headers.authorization as string;
  if (req.headers["x-tenant-id"]) forwardHeaders["x-tenant-id"] = req.headers["x-tenant-id"] as string;
  if (req.headers["x-correlation-id"]) forwardHeaders["x-correlation-id"] = req.headers["x-correlation-id"] as string;

  try {
    const fetchOptions: RequestInit = {
      method: req.method,
      headers: forwardHeaders,
      signal: AbortSignal.timeout(10_000),
    };
    if (req.method !== "GET" && req.body) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchOptions);
    const body = await response.text();

    reply.code(response.status);
    reply.header("content-type", response.headers.get("content-type") ?? "application/json");
    return reply.send(body);
  } catch (err) {
    req.log.warn({ err, targetUrl }, "proxy to inventory-service failed");
    throw new HttpError(502, "UPSTREAM_UNAVAILABLE", "inventory-service is unavailable");
  }
}

export async function proxyRoutes(app: FastifyInstance): Promise<void> {
  // Register inventory-compatible proxy routes if enabled
  if (process.env.INVENTORY_PROXY_ENABLED !== "true") return;

  for (const route of PROXY_ROUTES) {
    const handler = async (req: FastifyRequest, reply: FastifyReply) => {
      await forwardToInventory(req, reply);
    };

    switch (route.method) {
      case "GET":
        app.get(route.path, handler);
        break;
      case "POST":
        app.post(route.path, handler);
        break;
      case "PATCH":
        app.patch(route.path, handler);
        break;
    }
  }
}
