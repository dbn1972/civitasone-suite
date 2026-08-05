/**
 * CM-004 — 360-degree view. One authorised, tenant-scoped view aggregating every
 * CRM-LOCAL record related to a contact or account.
 *
 * Cross-service data: communications and calls are fetched from notification-service
 * and telephony-service respectively. Helpdesk cases and knowledge documents remain
 * as honest stubs since those services are not yet integrated.
 *
 * All cross-service calls use a 10s AbortController timeout and degrade gracefully
 * — a downstream failure NEVER causes this endpoint to 500.
 */
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });

/** Honest placeholders for data owned by services not yet integrated. */
const EXTERNAL_STUBS = {
  helpdeskCases: { count: null as number | null, source: "external" as const },
  knowledgeDocuments: { count: null as number | null, source: "external" as const },
};

// ── Cross-service configuration ──
const NOTIFICATION_BASE = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:3006";
const TELEPHONY_BASE = process.env.TELEPHONY_SERVICE_URL ?? "http://localhost:3026";
const FETCH_TIMEOUT_MS = 10_000;

/** Represents a cross-service section in the 360 response. */
interface CrossServiceSection<T> {
  items: T[];
  total: number;
  available: boolean;
  error?: string;
}

interface CommunicationItem {
  id: string;
  channel: string;
  direction: string;
  status: string;
  templateId?: string;
  subject?: string;
  sentAt: string;
  deliveryStatus?: string;
}

interface CallItem {
  id: string;
  direction: string;
  status: string;
  duration?: number;
  startedAt: string;
  recordingAvailable?: boolean;
}

interface ConversationItem {
  id: string;
  channel: string;
  lastMessageAt: string;
  messageCount: number;
  status: string;
}

/**
 * Fetch from an external service with a 10s timeout + auth header forwarding.
 * Returns parsed array on success, null on any failure (timeout, 5xx, network).
 */
async function fetchCrossService(
  url: string,
  headers: Record<string, string>,
): Promise<unknown[] | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (Array.isArray(body)) return body;
    if (body && typeof body === "object" && "data" in body && Array.isArray((body as Record<string, unknown>).data)) {
      return (body as Record<string, unknown>).data as unknown[];
    }
    return [];
  } catch {
    return null;
  }
}

/** Map notification-service delivery records to CommunicationItems. */
function mapCommunications(raw: unknown[]): CommunicationItem[] {
  return raw.map((r) => {
    const d = r as Record<string, unknown>;
    const item: CommunicationItem = {
      id: String(d.id ?? ""),
      channel: String(d.channel ?? "unknown"),
      direction: String(d.direction ?? "outbound"),
      status: String(d.status ?? "sent"),
      sentAt: String(d.sentAt ?? d.createdAt ?? ""),
    };
    if (d.templateId) item.templateId = String(d.templateId);
    if (d.subject) item.subject = String(d.subject);
    if (d.deliveryStatus) item.deliveryStatus = String(d.deliveryStatus);
    return item;
  });
}

/** Map telephony-service call records to CallItems. */
function mapCalls(raw: unknown[]): CallItem[] {
  return raw.map((r) => {
    const c = r as Record<string, unknown>;
    const item: CallItem = {
      id: String(c.id ?? ""),
      direction: String(c.direction ?? "outbound"),
      status: String(c.status ?? "completed"),
      startedAt: String(c.startedAt ?? c.createdAt ?? ""),
    };
    if (typeof c.duration === "number") item.duration = c.duration;
    if (typeof c.recordingAvailable === "boolean") item.recordingAvailable = c.recordingAvailable;
    return item;
  });
}

/** Map notification-service inbox records to ConversationItems. */
function mapConversations(raw: unknown[]): ConversationItem[] {
  return raw.map((r) => {
    const cv = r as Record<string, unknown>;
    return {
      id: String(cv.id ?? ""),
      channel: String(cv.channel ?? "unknown"),
      lastMessageAt: String(cv.lastMessageAt ?? cv.updatedAt ?? ""),
      messageCount: typeof cv.messageCount === "number" ? cv.messageCount : 0,
      status: String(cv.status ?? "open"),
    };
  });
}

/**
 * Fetch all cross-service data for a contact: communications, calls, conversations.
 * Each section degrades independently — a single failure doesn't block the others.
 */
async function fetchCrossServiceData(
  contactId: string,
  downstreamHeaders: Record<string, string>,
): Promise<{
  communications: CrossServiceSection<CommunicationItem>;
  calls: CrossServiceSection<CallItem>;
  conversations: CrossServiceSection<ConversationItem>;
}> {
  const [deliveriesRaw, callsRaw, conversationsRaw] = await Promise.allSettled([
    fetchCrossService(
      `${NOTIFICATION_BASE}/notifications/deliveries?recipientId=${contactId}&limit=20`,
      downstreamHeaders,
    ),
    fetchCrossService(
      `${TELEPHONY_BASE}/v1/telephony/calls?contactId=${contactId}&limit=20`,
      downstreamHeaders,
    ),
    fetchCrossService(
      `${NOTIFICATION_BASE}/v1/notification/inbox?contactId=${contactId}&limit=10`,
      downstreamHeaders,
    ),
  ]);

  const deliveries = deliveriesRaw.status === "fulfilled" ? deliveriesRaw.value : null;
  const calls = callsRaw.status === "fulfilled" ? callsRaw.value : null;
  const conversations = conversationsRaw.status === "fulfilled" ? conversationsRaw.value : null;

  return {
    communications: deliveries
      ? { items: mapCommunications(deliveries), total: deliveries.length, available: true }
      : { items: [], total: 0, available: false, error: "service_unavailable" },
    calls: calls
      ? { items: mapCalls(calls), total: calls.length, available: true }
      : { items: [], total: 0, available: false, error: "service_unavailable" },
    conversations: conversations
      ? { items: mapConversations(conversations), total: conversations.length, available: true }
      : { items: [], total: 0, available: false, error: "not_implemented" },
  };
}

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

      const localCommunications = (await tx.execute(sql`
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
        subjectType: "contact" as const,
        contact: {
          id: b.id, name: b.name, leadStatus: b.leadStatus, ownerId: b.ownerId, accountId: b.accountId,
          score: b.score, lastActivityAt: b.lastActivityAt,
        },
        consent: { marketingConsent: b.marketingConsent, consentDate: b.consentDate },
        activities, localCommunications, nextActions, contactRoles: roles, deals, quotations, addresses, syncedItems,
      };
    });

    if (!view) throw new HttpError(404, "NOT_FOUND", "contact not found");

    // Fetch cross-service data (communications, calls, conversations)
    const downstreamHeaders: Record<string, string> = {
      authorization: req.headers.authorization ?? "",
      "x-tenant-id": ctx.tenantId,
      "x-correlation-id": (req.headers["x-correlation-id"] as string) ?? req.id,
    };

    const crossService = await fetchCrossServiceData(id, downstreamHeaders);

    return reply.send({
      data: {
        ...view,
        communications: crossService.communications,
        calls: crossService.calls,
        conversations: crossService.conversations,
        external: EXTERNAL_STUBS,
      },
    });
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
