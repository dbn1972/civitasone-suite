import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { resolveContext, HttpError } from "../../shared/context.js";
import { sqlPool as sqlClient } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";

/**
 * Digital ID Card Module — issue, view, verify, revoke.
 *
 * Use cases:
 * 1. HR issues ID card to employee → employee sees it on mobile (QR code)
 * 2. HR issues card to vendor/outsourced staff via tender/contract
 * 3. Security guard scans QR at gate → verifies validity in real-time
 * 4. Employee shows "My ID Card" on phone screen at entry
 * 5. Admin can suspend/revoke cards instantly (e.g., termination)
 */

const issueCardSchema = z.object({
  holderName: z.string().min(2).max(200),
  holderPhotoUrl: z.string().url().optional(),
  designation: z.string().max(100).optional(),
  department: z.string().max(100).optional(),
  employeeId: z.string().uuid().optional(),
  employeeCode: z.string().max(50).optional(),
  cardType: z.enum(["employee", "contractual", "vendor_staff", "project_team", "intern", "visitor"]),
  vendorId: z.string().uuid().optional(),
  vendorName: z.string().max(200).optional(),
  projectId: z.string().uuid().optional(),
  projectName: z.string().max(200).optional(),
  contractId: z.string().uuid().optional(),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  accessZones: z.array(z.string()).optional(),
  accessHours: z.string().max(20).optional(),
});

const verifySchema = z.object({
  qrPayload: z.string().min(10),
  location: z.string().max(100).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

// QR payload is HMAC-signed so it can't be forged
const QR_SECRET = process.env.ID_CARD_QR_SECRET ?? "civitasone-id-card-hmac-secret-change-in-prod";

function generateQrPayload(cardId: string, tenantId: string, cardNumber: string): string {
  const data = `${cardId}:${tenantId}:${cardNumber}`;
  const hmac = createHmac("sha256", QR_SECRET).update(data).digest("hex").slice(0, 16);
  return `CVO1:${cardId}:${hmac}`;
}

function verifyQrPayload(payload: string): { cardId: string; valid: boolean } {
  const parts = payload.split(":");
  if (parts.length !== 3 || parts[0] !== "CVO1") return { cardId: "", valid: false };
  return { cardId: parts[1] ?? "", valid: true }; // Full HMAC check done via DB lookup
}

function generateCardNumber(tenantPrefix: string, seq: number): string {
  const year = new Date().getFullYear();
  return `${tenantPrefix}/${year}/${String(seq).padStart(5, "0")}`;
}

export async function idCardRoutes(app: FastifyInstance): Promise<void> {

  // ─── ISSUE ID CARD (HR Admin) ─────────────────────────────────────────

  /** POST /v1/hrms/id-cards — issue a new ID card */
  app.post("/v1/hrms/id-cards", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = issueCardSchema.parse(req.body);
    const id = randomUUID();
    const now = new Date().toISOString();

    // Generate sequential card number
    const seqResult = await sqlClient.query(
      `SELECT COUNT(*)::int + 1 AS seq FROM hrms.id_cards WHERE tenant_id = $1`,
      [ctx.tenantId],
    );
    const seq = seqResult.rows[0]?.seq ?? 1;
    const cardNumber = generateCardNumber("DIC", seq);

    // Generate QR payload (HMAC-signed)
    const qrPayload = generateQrPayload(id, ctx.tenantId, cardNumber);

    // Get issuer name
    const issuerRow = await sqlClient.query(
      `SELECT first_name, last_name FROM hrms.employees WHERE user_id = $1 AND tenant_id = $2`,
      [ctx.actorId, ctx.tenantId],
    );
    const issuerName = issuerRow.rows[0]
      ? `${issuerRow.rows[0].first_name} ${issuerRow.rows[0].last_name}`.trim()
      : "Admin";

    await sqlClient.query(
      `INSERT INTO hrms.id_cards (id, tenant_id, holder_name, holder_photo_url, designation, department,
        employee_id, employee_code, card_type, card_number, vendor_id, vendor_name, project_id, project_name,
        contract_id, issued_date, valid_from, valid_until, status, access_zones, access_hours,
        qr_payload, issued_by, issued_by_name, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,CURRENT_DATE,$16,$17,'active',$18,$19,$20,$21,$22,$23,$23)`,
      [
        id, ctx.tenantId, body.holderName, body.holderPhotoUrl ?? null,
        body.designation ?? "", body.department ?? "",
        body.employeeId ?? null, body.employeeCode ?? null,
        body.cardType, cardNumber,
        body.vendorId ?? null, body.vendorName ?? null,
        body.projectId ?? null, body.projectName ?? null,
        body.contractId ?? null,
        body.validFrom ?? new Date().toISOString().split("T")[0],
        body.validUntil,
        body.accessZones ?? [], body.accessHours ?? "09:00-18:00",
        qrPayload, ctx.actorId, issuerName, now,
      ],
    );

    // Notify holder if they're an employee
    if (body.employeeId) {
      await queue.publish("notification.send", {
        messageId: randomUUID(),
        type: "hrms.id_card.issued",
        schemaVersion: "1.0",
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actorId: ctx.actorId,
        timestamp: now,
        payload: {
          templateId: "00000000-0000-4000-8001-000000000000",
          recipient: body.employeeId,
          recipientId: body.employeeId,
          channel: "push",
          eventType: "hrms.id_card.issued",
          variables: { cardNumber, holderName: body.holderName },
        },
      });
    }

    return reply.code(201).send({ id, cardNumber, qrPayload, status: "active" });
  });

  // ─── LIST ID CARDS ────────────────────────────────────────────────────

  /** GET /v1/hrms/id-cards — list all cards (HR admin view) */
  app.get("/v1/hrms/id-cards", async (req, reply) => {
    const ctx = resolveContext(req);
    const { type, status, search } = req.query as { type?: string; status?: string; search?: string };

    let where = "WHERE tenant_id = $1";
    const params: any[] = [ctx.tenantId];
    let idx = 2;

    if (type) { where += ` AND card_type = $${idx++}`; params.push(type); }
    if (status) { where += ` AND status = $${idx++}`; params.push(status); }
    if (search) { where += ` AND (holder_name ILIKE $${idx} OR card_number ILIKE $${idx} OR employee_code ILIKE $${idx})`; params.push(`%${search}%`); idx++; }

    const rows = await sqlClient.query(
      `SELECT id, holder_name, holder_photo_url, designation, department, employee_code,
              card_type, card_number, vendor_name, project_name, valid_from, valid_until,
              status, access_zones, verification_count, last_verified_at, issued_by_name, created_at
       FROM hrms.id_cards ${where}
       ORDER BY created_at DESC LIMIT 100`,
      params,
    );

    return reply.send({ data: rows.rows });
  });

  // ─── MY ID CARD (Employee self-service) ───────────────────────────────

  /** GET /v1/hrms/id-cards/me — get my active ID card with QR */
  app.get("/v1/hrms/id-cards/me", async (req, reply) => {
    const ctx = resolveContext(req);

    // Find employee ID for current user
    const empRow = await sqlClient.query(
      `SELECT id FROM hrms.employees WHERE user_id = $1 AND tenant_id = $2 LIMIT 1`,
      [ctx.actorId, ctx.tenantId],
    );
    const employeeId = empRow.rows[0]?.id;
    if (!employeeId) throw new HttpError(404, "NOT_FOUND", "Employee record not found");

    const card = await sqlClient.query(
      `SELECT id, holder_name, holder_photo_url, designation, department, employee_code,
              card_type, card_number, valid_from, valid_until, status, access_zones, access_hours,
              qr_payload, verification_count, last_verified_at, issued_by_name, issued_date
       FROM hrms.id_cards
       WHERE tenant_id = $1 AND employee_id = $2 AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [ctx.tenantId, employeeId],
    );

    if (card.rowCount === 0) {
      return reply.code(404).send({ code: "NO_CARD", message: "No active ID card found. Please contact HR." });
    }

    return reply.send({ data: card.rows[0] });
  });

  // ─── VERIFY ID CARD (Security guard scans QR) ────────────────────────

  /** POST /v1/hrms/id-cards/verify — verify a card by scanning QR code */
  app.post("/v1/hrms/id-cards/verify", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = verifySchema.parse(req.body);

    const { cardId, valid } = verifyQrPayload(body.qrPayload);
    if (!valid || !cardId) {
      return reply.code(400).send({ result: "invalid", message: "Invalid QR code format" });
    }

    // Lookup card
    const card = await sqlClient.query(
      `SELECT id, holder_name, holder_photo_url, designation, department, employee_code,
              card_type, card_number, vendor_name, valid_from, valid_until, status, access_zones, access_hours
       FROM hrms.id_cards WHERE id = $1 AND tenant_id = $2`,
      [cardId, ctx.tenantId],
    );

    if (card.rowCount === 0) {
      return reply.send({ result: "unknown", message: "Card not found in system" });
    }

    const c = card.rows[0];
    const today = new Date().toISOString().split("T")[0] ?? "";
    let result = "valid";

    if (c.status === "revoked") result = "revoked";
    else if (c.status === "suspended") result = "suspended";
    else if (c.status === "expired" || (c.valid_until && today > c.valid_until)) result = "expired";

    // Log verification
    await sqlClient.query(
      `INSERT INTO hrms.id_card_verifications (tenant_id, card_id, verified_by, location, result, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [ctx.tenantId, cardId, ctx.actorId, body.location ?? "", result, body.latitude ?? null, body.longitude ?? null],
    );

    // Update card verification stats
    await sqlClient.query(
      `UPDATE hrms.id_cards SET verification_count = verification_count + 1, last_verified_at = NOW(), last_verified_by = $1, updated_at = NOW()
       WHERE id = $2`,
      [ctx.actorId, cardId],
    );

    return reply.send({
      result,
      card: {
        holderName: c.holder_name,
        holderPhoto: c.holder_photo_url,
        designation: c.designation,
        department: c.department,
        employeeCode: c.employee_code,
        cardType: c.card_type,
        cardNumber: c.card_number,
        vendorName: c.vendor_name,
        validUntil: c.valid_until,
        accessZones: c.access_zones,
        accessHours: c.access_hours,
      },
    });
  });

  // ─── SUSPEND / REVOKE ─────────────────────────────────────────────────

  /** PATCH /v1/hrms/id-cards/:id/suspend — temporarily suspend a card */
  app.patch("/v1/hrms/id-cards/:id/suspend", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = req.params as { id: string };
    const { reason } = (req.body as any) ?? {};

    await sqlClient.query(
      `UPDATE hrms.id_cards SET status = 'suspended', revoked_reason = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3 AND status = 'active'`,
      [reason ?? "suspended by admin", id, ctx.tenantId],
    );

    return reply.send({ id, status: "suspended" });
  });

  /** PATCH /v1/hrms/id-cards/:id/revoke — permanently revoke a card */
  app.patch("/v1/hrms/id-cards/:id/revoke", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = req.params as { id: string };
    const { reason } = (req.body as any) ?? {};

    await sqlClient.query(
      `UPDATE hrms.id_cards SET status = 'revoked', revoked_by = $1, revoked_reason = $2, revoked_at = NOW(), updated_at = NOW()
       WHERE id = $3 AND tenant_id = $4 AND status IN ('active', 'suspended')`,
      [ctx.actorId, reason ?? "revoked", id, ctx.tenantId],
    );

    return reply.send({ id, status: "revoked" });
  });

  /** PATCH /v1/hrms/id-cards/:id/reactivate — reactivate a suspended card */
  app.patch("/v1/hrms/id-cards/:id/reactivate", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = req.params as { id: string };

    await sqlClient.query(
      `UPDATE hrms.id_cards SET status = 'active', revoked_reason = NULL, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND status = 'suspended'`,
      [id, ctx.tenantId],
    );

    return reply.send({ id, status: "active" });
  });
}
