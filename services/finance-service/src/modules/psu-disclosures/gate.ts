/**
 * PSU v1 slice C: the ONE centralised gate for the PSU-only routes (same shape as shared/commercial-gate.ts). A Fastify preHandler that
 * reads the tenant's STORED coa_template and govt_owned from gl.finance_settings and answers 404 PSU_NOT_ENABLED unless the chart is
 * `commercial` AND govt_owned is set -- so a govt tenant, a plain commercial company, and a tenant with no settings row all see nothing.
 * Keyed on stored settings, never on edition / profile.
 */
import type { FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { financeSettings } from "../approvals/schema.js";
import { resolveContext, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";

export async function psuTenantGate(req: FastifyRequest): Promise<void> {
  const ctx = resolveContext(req);
  const rows = await scopedRead((tx) => tx.select({ c: financeSettings.coaTemplate, g: financeSettings.govtOwned }).from(financeSettings).where(eq(financeSettings.tenantId, ctx.tenantId)).limit(1));
  if (rows[0]?.c !== "commercial" || rows[0]?.g !== true) throw new HttpError(404, "PSU_NOT_ENABLED", "the PSU finance disclosures are not available for this tenant");
}
