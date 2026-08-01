/**
 * Contact identity resolution routes (CH-18 + INT-05).
 * POST /v1/crm/contacts/resolve — find best-match contact by email/phone/name
 * POST /v1/crm/contacts/dedup — find potential duplicates among given contacts
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { contacts } from "./schema.js";
import { eq, and, inArray } from "drizzle-orm";
import { normalizePhone, normalizeEmail, matchScore } from "./identity-domain.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];

const resolveBody = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(3).max(32).optional(),
  name: z.string().min(1).max(200).optional(),
}).refine(
  (b) => b.email !== undefined || b.phone !== undefined || b.name !== undefined,
  { message: "at least one of email, phone, or name is required" },
);

const dedupBody = z.object({
  contactIds: z.array(z.string().uuid()).min(2).max(100),
});

export async function identityRoutes(app: FastifyInstance): Promise<void> {
  /** Resolve a contact by email/phone/name best match */
  app.post("/v1/crm/contacts/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = resolveBody.parse(req.body);

    // Try exact match on email blind index first
    if (body.email) {
      const normalizedEmail = normalizeEmail(body.email);
      const emailMatch = await scopedRead(async (tx) => {
        const result = tx.select({
          id: contacts.id,
          name: contacts.name,
          email: contacts.email,
          phone: contacts.phone,
          status: contacts.status,
        }).from(contacts).where(
          and(
            eq(contacts.tenantId, ctx.tenantId),
            eq(contacts.emailIdx, normalizedEmail),
            eq(contacts.status, "active"),
          ),
        );
        return result;
      });

      const match = emailMatch[0];
      if (match) {
        return reply.send({ data: match, matchType: "email_exact" });
      }
    }

    // Try phone match
    if (body.phone) {
      const normalizedPhone = normalizePhone(body.phone);
      const allContacts = await scopedRead(async (tx) => {
        return tx.select({
          id: contacts.id,
          name: contacts.name,
          email: contacts.email,
          phone: contacts.phone,
          status: contacts.status,
        }).from(contacts).where(
          and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.status, "active")),
        );
      });

      const phoneMatch = allContacts.find((c) => {
        if (!c.phone) return false;
        return normalizePhone(c.phone) === normalizedPhone;
      });

      if (phoneMatch) {
        return reply.send({ data: phoneMatch, matchType: "phone_exact" });
      }
    }

    // Fuzzy name match
    if (body.name) {
      const allContacts = await scopedRead(async (tx) => {
        return tx.select({
          id: contacts.id,
          name: contacts.name,
          email: contacts.email,
          phone: contacts.phone,
          status: contacts.status,
        }).from(contacts).where(
          and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.status, "active")),
        );
      });

      let bestMatch: (typeof allContacts)[number] | null = null;
      let bestScore = 0;
      for (const c of allContacts) {
        const score = matchScore(body.name, c.name);
        if (score > bestScore && score >= 50) {
          bestScore = score;
          bestMatch = c;
        }
      }

      if (bestMatch) {
        return reply.send({ data: bestMatch, matchType: "name_fuzzy", score: bestScore });
      }
    }

    return reply.send({ data: null, matchType: "none" });
  });

  /** Find potential duplicates by email/phone overlap (INT-05) */
  app.post("/v1/crm/contacts/dedup", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { contactIds } = dedupBody.parse(req.body);

    const contactData = await scopedRead(async (tx) => {
      return tx.select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        phone: contacts.phone,
        emailIdx: contacts.emailIdx,
      }).from(contacts).where(
        and(eq(contacts.tenantId, ctx.tenantId), inArray(contacts.id, contactIds)),
      );
    });

    // Find duplicates: contacts that share same emailIdx or phone
    const duplicateGroups: Array<{ contactA: string; contactB: string; matchField: string }> = [];

    for (let i = 0; i < contactData.length; i++) {
      for (let j = i + 1; j < contactData.length; j++) {
        const a = contactData[i]!;
        const b = contactData[j]!;

        if (a.emailIdx && b.emailIdx && a.emailIdx === b.emailIdx) {
          duplicateGroups.push({ contactA: a.id, contactB: b.id, matchField: "email" });
        } else if (a.phone && b.phone && normalizePhone(a.phone) === normalizePhone(b.phone)) {
          duplicateGroups.push({ contactA: a.id, contactB: b.id, matchField: "phone" });
        }
      }
    }

    return reply.send({ data: duplicateGroups });
  });
}
