/**
 * MSME commercial: the ONE centralised gate for commercial-only routes (design contract item 4). A Fastify preHandler that reads the
 * tenant's STORED coa_template from gl.finance_settings and answers 404 COMMERCIAL_NOT_ENABLED for a government (govt) tenant -- or a
 * tenant with no settings row yet, which reads as govt -- before any handler runs. Registered once per commercial route plugin
 * (app.addHook), so no handler carries its own tenant-type check. Keyed on stored settings, never on edition / profile.
 */
import type { FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { financeSettings } from "../modules/approvals/schema.js";
import { resolveContext, HttpError } from "./context.js";
import { scopedRead } from "./db.js";

export async function commercialTenantGate(req: FastifyRequest): Promise<void> {
  const ctx = resolveContext(req);
  const rows = await scopedRead((tx) => tx.select({ c: financeSettings.coaTemplate }).from(financeSettings).where(eq(financeSettings.tenantId, ctx.tenantId)).limit(1));
  const template = rows[0]?.c ?? "govt";
  if (template === "govt") throw new HttpError(404, "COMMERCIAL_NOT_ENABLED", "sales invoicing is not available for this tenant");
}
