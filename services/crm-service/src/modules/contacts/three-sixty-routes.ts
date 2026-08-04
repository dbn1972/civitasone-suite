/**
 * CM-004 — 360-degree view. One authorised, tenant-scoped view aggregating every
 * CRM-LOCAL record related to a contact or account.
 *
 * Cross-service data (helpdesk cases, knowledge documents) is DELIBERATELY not
 * fetched here — this worktree owns only the crm schema. Those appear as honest
 * reference stubs { count: null, source: "external" } so the FE renders a link /
 * placeholder rather than a fabricated 0.
 */
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });

/** Honest placeholders for data owned by other services (not called from here). */
const EXTERNAL_STUBS = {
  helpdeskCases: { count: null as number | null, source: "external" as const },
  knowledgeDocuments: { count: null as number | null, source: "external" as const },
};

type Rows = Array<Record<string, unknown>>;

export async function threeSixtyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/contacts/:id/360", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const t = ctx.tenantId;

    const view = await scopedRead(async (tx) => {
      const base = (await tx.execute(sql`
        SELECT id, name, lead_status AS "leadStatus", owner_id AS "ownerId", account_id AS "accountId",
               score, marketing_consent AS "marketingConsent", consent_date AS "consentDate",
               last_activity_at AS "lastActivityAt"
        FROM crm.contacts WHERE id = ${id} AND tenant_id = ${t}
      `)) as unknown as Rows;
      if (base.length === 0) return null;

      const activities = (await tx.execute(sql`
        SELECT id, type, subject, status, due_date AS "dueDate", remind_at AS "remindAt",
               location, completed_at AS "completedAt", created_at AS "createdAt"
        FROM crm.activities WHERE tenant_id = ${t} AND contact_id = ${id}
        ORDER BY created_at DESC LIMIT 20
      `)) as unknown as Rows;

      const communications = (await tx.execute(sql`
        SELECT id, direction, channel, outcome, disposition, summary, occurred_at AS "occurredAt"
        FROM crm.communications WHERE tenant_id = ${t} AND subject_type = 'contact' AND subject_id = ${id}
        ORDER BY occurred_at DESC LIMIT 20
      `)) as unknown as Rows;

      const nextActions = (await tx.execute(sql`
        SELECT id, action_type AS "actionType", due_at AS "dueAt", notes, completed_at AS "completedAt"
        FROM crm.next_actions WHERE tenant_id = ${t} AND subject_type = 'contact' AND subject_id = ${id}
        ORDER BY due_at ASC
      `)) as unknown as Rows;

      const roles = (await tx.execute(sql`
        SELECT id, deal_id AS "dealId", role FROM crm.contact_roles
        WHERE tenant_id = ${t} AND contact_id = ${id} ORDER BY created_at DESC
      `)) as unknown as Rows;

      const deals = (await tx.execute(sql`
        SELECT id, name, stage, value_minor AS "valueMinor", currency, status
        FROM crm.deals WHERE tenant_id = ${t} AND contact_id = ${id} ORDER BY created_at DESC
      `)) as unknown as Rows;

      const quotations = (await tx.execute(sql`
        SELECT q.id, q.quote_ref AS "quoteRef", q.version_number AS "versionNumber", q.status,
               q.total_minor AS "totalMinor", q.currency
        FROM crm.quotations q
        WHERE q.tenant_id = ${t}
          AND q.deal_id IN (SELECT id FROM crm.deals WHERE tenant_id = ${t} AND contact_id = ${id})
        ORDER BY q.created_at DESC
      `)) as unknown as Rows;

      const addresses = (await tx.execute(sql`
        SELECT id, address_type AS "addressType", line1, line2, city, state, pincode, country, is_primary AS "isPrimary"
        FROM crm.addresses WHERE tenant_id = ${t} AND owner_type = 'contact' AND owner_id = ${id}
        ORDER BY is_primary DESC, created_at DESC
      `)) as unknown as Rows;

      const syncedItems = (await tx.execute(sql`
        SELECT id, kind, external_id AS "externalId", occurred_at AS "occurredAt"
        FROM crm.synced_items WHERE tenant_id = ${t} AND subject_type = 'contact' AND subject_id = ${id}
        ORDER BY occurred_at DESC LIMIT 20
      `)) as unknown as Rows;

      const b = base[0]!;
      return {
        subjectType: "contact",
        contact: {
          id: b.id, name: b.name, leadStatus: b.leadStatus, ownerId: b.ownerId, accountId: b.accountId,
          score: b.score, lastActivityAt: b.lastActivityAt,
        },
        consent: { marketingConsent: b.marketingConsent, consentDate: b.consentDate },
        activities, communications, nextActions, contactRoles: roles, deals, quotations, addresses, syncedItems,
        external: EXTERNAL_STUBS,
      };
    });

    if (!view) throw new HttpError(404, "NOT_FOUND", "contact not found");
    return reply.send({ data: view });
  });

  app.get("/v1/crm/accounts/:id/360", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const t = ctx.tenantId;

    const view = await scopedRead(async (tx) => {
      const base = (await tx.execute(sql`
        SELECT id, name, industry, website, status, parent_id AS "parentId"
        FROM crm.accounts WHERE id = ${id} AND tenant_id = ${t}
      `)) as unknown as Rows;
      if (base.length === 0) return null;

      const contacts = (await tx.execute(sql`
        SELECT id, name, lead_status AS "leadStatus", owner_id AS "ownerId"
        FROM crm.contacts WHERE tenant_id = ${t} AND account_id = ${id}
        ORDER BY created_at DESC LIMIT 50
      `)) as unknown as Rows;

      const childAccounts = (await tx.execute(sql`
        SELECT id, name, status FROM crm.accounts WHERE tenant_id = ${t} AND parent_id = ${id}
        ORDER BY name ASC
      `)) as unknown as Rows;

      const relationships = (await tx.execute(sql`
        SELECT r.id, r.to_account_id AS "toAccountId", r.rel_type AS "relType", a.name AS "toAccountName"
        FROM crm.account_relationships r
        LEFT JOIN crm.accounts a ON a.id = r.to_account_id AND a.tenant_id = r.tenant_id
        WHERE r.tenant_id = ${t} AND r.from_account_id = ${id} ORDER BY r.created_at DESC
      `)) as unknown as Rows;

      const deals = (await tx.execute(sql`
        SELECT id, name, stage, value_minor AS "valueMinor", currency, status
        FROM crm.deals WHERE tenant_id = ${t}
          AND contact_id IN (SELECT id FROM crm.contacts WHERE tenant_id = ${t} AND account_id = ${id})
        ORDER BY created_at DESC
      `)) as unknown as Rows;

      const communications = (await tx.execute(sql`
        SELECT id, direction, channel, outcome, disposition, summary, occurred_at AS "occurredAt"
        FROM crm.communications WHERE tenant_id = ${t} AND subject_type = 'account' AND subject_id = ${id}
        ORDER BY occurred_at DESC LIMIT 20
      `)) as unknown as Rows;

      const addresses = (await tx.execute(sql`
        SELECT id, address_type AS "addressType", line1, line2, city, state, pincode, country, is_primary AS "isPrimary"
        FROM crm.addresses WHERE tenant_id = ${t} AND owner_type = 'account' AND owner_id = ${id}
        ORDER BY is_primary DESC, created_at DESC
      `)) as unknown as Rows;

      const syncedItems = (await tx.execute(sql`
        SELECT id, kind, external_id AS "externalId", occurred_at AS "occurredAt"
        FROM crm.synced_items WHERE tenant_id = ${t} AND subject_type = 'account' AND subject_id = ${id}
        ORDER BY occurred_at DESC LIMIT 20
      `)) as unknown as Rows;

      const b = base[0]!;
      return {
        subjectType: "account",
        account: { id: b.id, name: b.name, industry: b.industry, website: b.website, status: b.status, parentId: b.parentId },
        contacts, childAccounts, relationships, deals, communications, addresses, syncedItems,
        external: EXTERNAL_STUBS,
      };
    });

    if (!view) throw new HttpError(404, "NOT_FOUND", "account not found");
    return reply.send({ data: view });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
