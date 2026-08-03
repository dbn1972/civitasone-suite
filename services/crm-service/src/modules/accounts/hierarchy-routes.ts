/**
 * Account hierarchy routes (CM-002).
 * GET /v1/crm/accounts/:id/children — list child accounts
 * GET /v1/crm/accounts/:id/ancestors — list parent chain (recursive)
 * PATCH /v1/crm/accounts/:id/parent — set parentId (validate no cycles) → 202
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { sql } from "drizzle-orm";
import { wouldCreateCycle, buildAncestorChain, type AccountNode } from "./hierarchy-domain.js";
import { COMMANDS } from "../../topics.js";
import { publishCrmCommand } from "../../shared/residual-publish.js";
import { cache } from "../../shared/infra.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
const setParentBody = z.object({
  parentId: z.string().uuid().nullable(),
});

export async function hierarchyRoutes(app: FastifyInstance): Promise<void> {
  /** List child accounts of a given parent */
  app.get("/v1/crm/accounts/:id/children", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);

    const children = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT id, name, industry, website, status, parent_id as "parentId", version
        FROM crm.accounts
        WHERE tenant_id = ${ctx.tenantId} AND parent_id = ${id}
        ORDER BY name ASC
      `) as unknown as Array<Record<string, unknown>>;
    });

    return reply.send({ data: children });
  });

  /** Get ancestor chain (parent → grandparent → root) */
  app.get("/v1/crm/accounts/:id/ancestors", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);

    // Load all accounts for the tenant to build a map (efficient for typical org sizes)
    const allAccounts = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT id, parent_id as "parentId", name
        FROM crm.accounts
        WHERE tenant_id = ${ctx.tenantId}
      `) as unknown as Array<{ id: string; parentId: string | null; name: string }>;
    });

    const accountsMap = new Map<string, AccountNode>();
    const nameMap = new Map<string, string>();
    for (const a of allAccounts) {
      accountsMap.set(a.id, { id: a.id, parentId: a.parentId });
      nameMap.set(a.id, a.name);
    }

    if (!accountsMap.has(id)) {
      throw new HttpError(404, "NOT_FOUND", "account not found");
    }

    const ancestorIds = buildAncestorChain(id, accountsMap);
    const ancestors = ancestorIds.map((aid) => ({
      id: aid,
      name: nameMap.get(aid) ?? "unknown",
    }));

    return reply.send({ data: ancestors });
  });

  /** Set or clear the parent of an account (cycle detection before enqueue). */
  app.patch("/v1/crm/accounts/:id/parent", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const { parentId } = setParentBody.parse(req.body);

    // Load all accounts for cycle detection (read path — OK)
    const allAccounts = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT id, parent_id as "parentId"
        FROM crm.accounts
        WHERE tenant_id = ${ctx.tenantId}
      `) as unknown as Array<{ id: string; parentId: string | null }>;
    });

    const accountsMap = new Map<string, AccountNode>();
    for (const a of allAccounts) {
      accountsMap.set(a.id, { id: a.id, parentId: a.parentId });
    }

    if (!accountsMap.has(id)) {
      throw new HttpError(404, "NOT_FOUND", "account not found");
    }

    if (parentId !== null) {
      if (!accountsMap.has(parentId)) {
        throw new HttpError(404, "NOT_FOUND", "parent account not found");
      }
      if (wouldCreateCycle(id, parentId, accountsMap)) {
        throw new HttpError(422, "CYCLE_DETECTED", "setting this parent would create a circular hierarchy");
      }
    }

    const accepted = await publishCrmCommand(ctx, COMMANDS.setAccountParent, id, { parentId });
    await cache.invalidateResource(ctx.tenantId, "account");
    return sendAccepted(reply, acceptedResponseSchema, accepted);
  });
}
