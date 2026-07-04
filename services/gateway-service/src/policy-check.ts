/**
 * Gateway-level ABAC policy enforcement.
 *
 * For mutation requests (POST, PUT, PATCH, DELETE), optionally calls the
 * policy-service ABAC evaluate endpoint to get a fine-grained allow/deny decision.
 *
 * Env-gated:
 *   POLICY_ENFORCE=true  — enforce (deny blocks the request)
 *   POLICY_ENFORCE=audit — log denials but allow through (shadow mode)
 *   POLICY_ENFORCE=off   — skip entirely (default, for backward compat)
 *
 *   POLICY_SERVICE_URL   — internal URL for policy-service
 */
import type { FastifyRequest, FastifyReply } from "fastify";
import { pino } from "pino";

const log = pino({ name: "gateway-policy" });

type EnforceMode = "off" | "audit" | "true";
const MODE = (process.env.POLICY_ENFORCE ?? "off") as EnforceMode;
const POLICY_URL = process.env.POLICY_SERVICE_URL ?? "http://localhost:3003";
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? "";

// Mutations that trigger policy evaluation
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Routes that skip policy (platform/auth routes)
const SKIP_ROUTES = new Set(["identity", "policy", "policy-v1", "audit", "audit-events", "install", "admin"]);

interface PolicyDecision {
  decision: "allow" | "deny";
  reason: string;
}

/**
 * Evaluate the request against policy-service ABAC rules.
 * Returns true if the request should proceed, false if denied.
 */
export async function checkPolicy(
  req: FastifyRequest,
  reply: FastifyReply,
  routeName: string,
): Promise<boolean> {
  // Skip if enforcement is off
  if (MODE === "off") return true;

  // Skip non-mutation requests (reads don't need ABAC at gateway level)
  if (!MUTATION_METHODS.has(req.method)) return true;

  // Skip platform routes
  if (SKIP_ROUTES.has(routeName)) return true;

  // Extract actor context from forwarded headers
  const tenantId = req.headers["x-tenant-id"] as string | undefined;
  const authorization = req.headers["authorization"] as string | undefined;
  if (!tenantId || !authorization) return true; // unauthenticated requests handled elsewhere

  try {
    const pathname = req.url.split("?")[0] ?? "/";
    // Derive resource and action from route
    const resource = routeName.replace(/-v1$/, "").replace(/-service$/, "");
    const action = methodToAction(req.method);

    const res = await fetch(`${POLICY_URL}/v1/policy/abac/evaluate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authorization,
        "x-tenant-id": tenantId,
        "x-internal": "1",
        "x-service-secret": INTERNAL_SECRET,
      },
      body: JSON.stringify({
        subject: { roles: [] }, // policy-service derives from JWT
        action: { type: action },
        resource: { type: resource, path: pathname },
        context: {},
      }),
      signal: AbortSignal.timeout(2000), // 2s timeout — don't block proxy on slow policy
    });

    if (!res.ok) {
      // Policy service unavailable — fail open in audit mode, fail CLOSED in enforce mode
      log.warn({ status: res.status, route: routeName }, "policy-service returned non-200");
      if (MODE === "true") {
        reply.code(503).send({
          code: "POLICY_UNAVAILABLE",
          message: "Policy service unavailable — request denied (fail-closed)",
          correlationId: req.id,
        });
        return false;
      }
      return true; // audit mode: allow through
    }

    const decision = await res.json() as PolicyDecision;

    if (decision.decision === "deny") {
      if (MODE === "true") {
        reply.code(403).send({
          code: "POLICY_DENIED",
          message: `Access denied by policy: ${decision.reason}`,
          correlationId: req.id,
        });
        return false;
      }
      // Audit mode: log but allow
      log.warn({ route: routeName, reason: decision.reason, actor: tenantId }, "policy DENY (audit mode — allowed)");
    }

    return true;
  } catch (err) {
    // Timeout or network error — fail CLOSED in enforce mode, open in audit
    log.error({ err, route: routeName }, "policy check failed");
    if (MODE === "true") {
      reply.code(503).send({
        code: "POLICY_UNAVAILABLE",
        message: "Policy service unreachable — request denied (fail-closed)",
        correlationId: req.id,
      });
      return false;
    }
    return true; // audit/off mode: allow
  }
}

function methodToAction(method: string): string {
  switch (method) {
    case "POST": return "create";
    case "PUT": return "update";
    case "PATCH": return "update";
    case "DELETE": return "delete";
    default: return "read";
  }
}
