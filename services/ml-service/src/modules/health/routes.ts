/**
 * Health Routes — GET /v1/ml/health
 *
 * Per-domain model availability status. Public (no auth required).
 * Returns whether an active model is available for each domain.
 *
 * Validates: Requirements 16.4
 */

import type { FastifyInstance } from "fastify";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { mlModels } from "../models/schema.js";
import { HttpError } from "../../shared/context.js";

const ALL_DOMAINS = ["leads", "tickets", "inventory", "subscriptions", "tasks", "transactions"] as const;

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/ml/health — Per-domain model availability status
   * No auth required (public health check)
   */
  app.get("/v1/ml/health", { config: { public: true } }, async (req, reply) => {
    const featureEnabled = process.env.FEATURE_ML_ENABLED === "true";

    if (!featureEnabled) {
      return reply.send({
        data: {
          status: "disabled",
          featureEnabled: false,
          domains: ALL_DOMAINS.map((d) => ({ domain: d, available: false, reason: "feature_disabled" })),
        },
      });
    }

    // Query for active models grouped by domain (across all tenants for health check)
    const activeModels = await db
      .select({
        domain: mlModels.domain,
        count: sql<number>`count(distinct ${mlModels.tenantId})::int`,
      })
      .from(mlModels)
      .where(eq(mlModels.status, "active"))
      .groupBy(mlModels.domain);

    const domainAvailability = new Map<string, number>();
    for (const row of activeModels) {
      domainAvailability.set(row.domain, row.count);
    }

    const domains = ALL_DOMAINS.map((domain) => {
      const tenantCount = domainAvailability.get(domain) ?? 0;
      return {
        domain,
        available: tenantCount > 0,
        activeTenants: tenantCount,
      };
    });

    const anyAvailable = domains.some((d) => d.available);

    return reply.send({
      data: {
        status: anyAvailable ? "operational" : "no_models",
        featureEnabled: true,
        domains,
      },
    });
  });
}
