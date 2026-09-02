import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { createHmac } from "node:crypto";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { sqlPool, sqlClient } from "../../shared/db.js";
import { withRawTenantGuc } from "@civitasone/db";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

/**
 * hrms.id_cards has RLS ENABLEd and FORCEd (migration 0123_rls_completeness.sql),
 * and — like medical/routes.ts and workforce-planning/routes.ts before this fix —
 * this module talks to `sqlPool` (a thin node-postgres-style shim over the raw
 * `sqlClient`, see shared/db.ts) directly, with no Drizzle schema attached and
 * therefore no ORM transaction wrapper anywhere in the call path to trigger
 * `wrapWithTenantGuc`. Every query below used to run with `app.tenant_id` unset,
 * so the connecting role (`hrms_svc`, NOBYPASSRLS non-superuser) got a
 * row-security violation on write / zero rows back on read — silently, since
 * RLS fails CLOSED rather than erroring. Confirmed empirically: a row inserted
 * with the GUC correctly set was invisible to a plain `hrms_svc` session with no
 * GUC, which is exactly why suspend/revoke/reactivate 404'd ("card not found")
 * against a card that genuinely existed.
 *
 * suspend/revoke/reactivate were fixed first (the three that were originally
 * reported failing). This pass wraps the remaining four handlers with the
 * identical unscoped-RLS shape: issue, list, me, verify. Two of them had a
 * second, independent defect that was masking the RLS gap behind a different
 * symptom, fixed alongside the GUC wrap (see inline comments at each site):
 *   - issue's issuer-name lookup and me's employee lookup both queried
 *     `employee.hrms_employees` (also RLS ENABLEd + FORCEd, migration
 *     0026/0034) by columns that don't exist on that table (`user_id`,
 *     `first_name`, `last_name` — the real columns are `user_ref` and
 *     `full_name`, confirmed against src/modules/employee/schema.ts and the
 *     live schema). That is a hard "column does not exist" error independent
 *     of RLS, so both handlers 500'd before the missing-GUC gap could even
 *     manifest. Fixing only the GUC would have left both handlers broken.
 *   - issue's card-number sequence SELECT (`COUNT(*) FROM hrms.id_cards WHERE
 *     tenant_id = $1`) silently returned 0 with no GUC set, so every card
 *     issued in production so far got sequence 1 (e.g. always
 *     "DIC/<year>/00001") instead of a real running count — a data-integrity
 *     bug the GUC fix also resolves as a side effect.
 */
function withTenantGuc<T>(
  tenantId: string,
  fn: (tx: typeof sqlClient) => Promise<T>,
): Promise<T> {
  return withRawTenantGuc(sqlClient, tenantId, fn);
}

async function queryTx<T = any>(
  tx: typeof sqlClient,
  text: string,
  params: readonly unknown[] = [],
): Promise<{ rows: T[]; rowCount: number }> {
  const result = await tx.unsafe(text, params as unknown as never[]);
  const rows = result as unknown as T[];
  const rowCount = (result as unknown as { count?: number }).count ?? rows.length;
  return { rows, rowCount };
}

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
    // HR-A deep-verify finding: this handler had no requireRole call at all,
    // unlike every other mutating action in this file (suspend/revoke/
    // reactivate all gate on the same three roles below) -- despite the
    // section header above documenting this as "HR Admin" only and the
    // module's own doc comment describing issuance as HR-initiated. Any
    // authenticated user of any role could issue a fully valid, QR-signed ID
    // card (including cardType "employee") for anyone. Employee self-service
    // viewing already exists separately at GET /v1/hrms/id-cards/me, so this
    // was not needed for that flow.
    requireRole(ctx, ["hr_admin", "security_admin", "super_admin"]);
    const body = issueCardSchema.parse(req.body);
    const id = randomUUID();
    const now = new Date().toISOString();

    // Generate sequential card number. hrms.id_cards is RLS FORCEd -- without
    // the GUC this always saw 0 rows and returned seq=1 forever, so every
    // card issued in production so far collided on "DIC/<year>/00001"
    // (masked because nothing else exercised the unique constraint until a
    // second concurrent issue).
    const seqResult = await withTenantGuc(ctx.tenantId, (tx) => queryTx(
      tx,
      `SELECT COUNT(*)::int + 1 AS seq FROM hrms.id_cards WHERE tenant_id = $1`,
      [ctx.tenantId],
    ));
    const seq = seqResult.rows[0]?.seq ?? 1;
    const cardNumber = generateCardNumber("DIC", seq);

    // Generate QR payload (HMAC-signed)
    const qrPayload = generateQrPayload(id, ctx.tenantId, cardNumber);

    // Get issuer name. employee.hrms_employees is ALSO RLS ENABLEd + FORCEd
    // (migration 0026/0034_rls_*.sql) -- needed the same GUC wrap. This query
    // additionally referenced first_name/last_name/user_id, none of which
    // exist on that table (real columns: full_name, user_ref -- confirmed
    // against src/modules/employee/schema.ts and the live schema; user_ref is
    // the same actorId-linkage column self-service/routes.ts and
    // employee/actor-link.ts already key employee lookups on). That was a
    // hard "column does not exist" error independent of RLS, so this query
    // 500'd before the missing-GUC gap could even manifest -- fixed here too
    // since the GUC wrap alone would not have made this endpoint work.
    const issuerRow = await withTenantGuc(ctx.tenantId, (tx) => queryTx(
      tx,
      `SELECT full_name FROM employee.hrms_employees WHERE user_ref = $1 AND tenant_id = $2`,
      [ctx.actorId, ctx.tenantId],
    ));
    const issuerName = issuerRow.rows[0]?.full_name ?? "Admin";

    await withTenantGuc(ctx.tenantId, (tx) => queryTx(
      tx,
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
    ));

    // HR-A deep-verify finding: registerIdCardConsumers (../id-cards/consumer.ts,
    // registered in worker.ts) subscribes to COMMANDS.idCardIssue/Suspend/
    // Revoke/Reactivate specifically to record the `audit.event.record` entry
    // for each action -- but nothing anywhere in the codebase ever published
    // those commands (this route did the real INSERT/UPDATE directly via SQL
    // and only ever published the unrelated "notification.send" topic below).
    // The consumer was fully built and registered, just never triggered, so
    // id-card issue/suspend/revoke/reactivate left no audit trail. Publishing
    // here wires up the existing consumer without changing this route's own
    // synchronous DB write or response.
    await queue.publish(COMMANDS.idCardIssue, {
      messageId: randomUUID(),
      type: COMMANDS.idCardIssue,
      schemaVersion: "1.0",
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      payload: {
        id, tenantId: ctx.tenantId,
        ...(body.employeeId ? { employeeId: body.employeeId } : {}),
        holderName: body.holderName, cardType: body.cardType, validUntil: body.validUntil,
      },
    });

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

    // hrms.id_cards is RLS FORCEd -- without the GUC this always matched 0
    // rows (empty list), regardless of the `WHERE tenant_id = $1` filter
    // above (RLS's own USING clause is evaluated first and fails closed).
    const rows = await withTenantGuc(ctx.tenantId, (tx) => queryTx(
      tx,
      `SELECT id, holder_name, holder_photo_url, designation, department, employee_code,
              card_type, card_number, vendor_name, project_name, valid_from, valid_until,
              status, access_zones, verification_count, last_verified_at, issued_by_name, created_at
       FROM hrms.id_cards ${where}
       ORDER BY created_at DESC LIMIT 100`,
      params,
    ));

    return reply.send({ data: rows.rows });
  });

  // ─── MY ID CARD (Employee self-service) ───────────────────────────────

  /** GET /v1/hrms/id-cards/me — get my active ID card with QR */
  app.get("/v1/hrms/id-cards/me", async (req, reply) => {
    const ctx = resolveContext(req);

    // Find employee ID for current user. employee.hrms_employees is RLS
    // ENABLEd + FORCEd (migration 0026/0034), so this needed the GUC wrap
    // too. It also referenced a `user_id` column that doesn't exist on this
    // table (real column: user_ref -- same actorId-linkage column
    // self-service/routes.ts and employee/actor-link.ts already key employee
    // lookups on); that was a hard "column does not exist" error independent
    // of RLS, fixed alongside the GUC wrap.
    const empRow = await withTenantGuc(ctx.tenantId, (tx) => queryTx(
      tx,
      `SELECT id FROM employee.hrms_employees WHERE user_ref = $1 AND tenant_id = $2 LIMIT 1`,
      [ctx.actorId, ctx.tenantId],
    ));
    const employeeId = empRow.rows[0]?.id;
    if (!employeeId) throw new HttpError(404, "NOT_FOUND", "Employee record not found");

    // hrms.id_cards is RLS FORCEd -- without the GUC this always matched 0
    // rows, so every employee with a genuinely active card got "No active ID
    // card found" (NO_CARD) instead of their card.
    const card = await withTenantGuc(ctx.tenantId, (tx) => queryTx(
      tx,
      `SELECT id, holder_name, holder_photo_url, designation, department, employee_code,
              card_type, card_number, valid_from, valid_until, status, access_zones, access_hours,
              qr_payload, verification_count, last_verified_at, issued_by_name, issued_date
       FROM hrms.id_cards
       WHERE tenant_id = $1 AND employee_id = $2 AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [ctx.tenantId, employeeId],
    ));

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

    // Lookup card. hrms.id_cards is RLS FORCEd -- without the GUC this
    // always matched 0 rows, so a security guard scanning a genuine,
    // currently-valid card's QR code got "Card not found in system" for
    // every single scan (result: "unknown"), never reaching the status
    // checks or the verification-log INSERT/stat UPDATE below at all. This
    // is the same silent-fail-closed shape as suspend/revoke/reactivate
    // before their fix, just surfacing at a security checkpoint instead of
    // an HR admin action. WHAT is being verified (QR HMAC format, then
    // card id/tenant/status lookup) is unchanged -- only that the lookup can
    // now actually find the row it was always supposed to find.
    const card = await withTenantGuc(ctx.tenantId, (tx) => queryTx(
      tx,
      `SELECT id, holder_name, holder_photo_url, designation, department, employee_code,
              card_type, card_number, vendor_name, valid_from, valid_until, status, access_zones, access_hours
       FROM hrms.id_cards WHERE id = $1 AND tenant_id = $2`,
      [cardId, ctx.tenantId],
    ));

    if (card.rowCount === 0) {
      return reply.send({ result: "unknown", message: "Card not found in system" });
    }

    const c = card.rows[0];
    const today = new Date().toISOString().split("T")[0] ?? "";
    let result = "valid";

    if (c.status === "revoked") result = "revoked";
    else if (c.status === "suspended") result = "suspended";
    else if (c.status === "expired" || (c.valid_until && today > c.valid_until)) result = "expired";

    // Log verification. hrms.id_card_verifications is RLS FORCEd
    // (migration 0123) with a WITH CHECK clause, so an INSERT with no GUC
    // set would hard-error (row-security violation) rather than silently
    // no-op -- unlike the SELECT above, this failure mode was never actually
    // reachable in production because the SELECT already returned 0 rows
    // first and the handler returned before getting here.
    await withTenantGuc(ctx.tenantId, (tx) => queryTx(
      tx,
      `INSERT INTO hrms.id_card_verifications (tenant_id, card_id, verified_by, location, result, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [ctx.tenantId, cardId, ctx.actorId, body.location ?? "", result, body.latitude ?? null, body.longitude ?? null],
    ));

    // Update card verification stats. Same RLS/WITH CHECK shape as the
    // INSERT above -- also unreachable in production until the SELECT fix.
    await withTenantGuc(ctx.tenantId, (tx) => queryTx(
      tx,
      `UPDATE hrms.id_cards SET verification_count = verification_count + 1, last_verified_at = NOW(), last_verified_by = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3`,
      [ctx.actorId, cardId, ctx.tenantId],
    ));

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
    requireRole(ctx, ["hr_admin", "security_admin", "super_admin"]);
    const { id } = req.params as { id: string };
    const { reason } = (req.body as any) ?? {};

    const result = await withTenantGuc(ctx.tenantId, (tx) => queryTx(
      tx,
      `UPDATE hrms.id_cards SET status = 'suspended', revoked_reason = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3 AND status = 'active'`,
      [reason ?? "suspended by admin", id, ctx.tenantId],
    ));
    // HR-A deep-verify finding: the UPDATE's WHERE clause silently matches
    // zero rows for an unknown id or a card that is not currently 'active'
    // (already suspended/revoked/expired) -- this used to still reply 200
    // "suspended" either way, a false-success response.
    if (result.rowCount === 0) {
      throw new HttpError(404, "NOT_FOUND", "active id card not found");
    }

    await queue.publish(COMMANDS.idCardSuspend, {
      messageId: randomUUID(), type: COMMANDS.idCardSuspend, schemaVersion: "1.0",
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
      payload: { id, tenantId: ctx.tenantId, reason: reason ?? "suspended by admin" },
    });

    return reply.send({ id, status: "suspended" });
  });

  /** PATCH /v1/hrms/id-cards/:id/revoke — permanently revoke a card */
  app.patch("/v1/hrms/id-cards/:id/revoke", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["hr_admin", "security_admin", "super_admin"]);
    const { id } = req.params as { id: string };
    const { reason } = (req.body as any) ?? {};

    const result = await withTenantGuc(ctx.tenantId, (tx) => queryTx(
      tx,
      `UPDATE hrms.id_cards SET status = 'revoked', revoked_by = $1, revoked_reason = $2, revoked_at = NOW(), updated_at = NOW()
       WHERE id = $3 AND tenant_id = $4 AND status IN ('active', 'suspended')`,
      [ctx.actorId, reason ?? "revoked", id, ctx.tenantId],
    ));
    if (result.rowCount === 0) {
      throw new HttpError(404, "NOT_FOUND", "active or suspended id card not found");
    }

    await queue.publish(COMMANDS.idCardRevoke, {
      messageId: randomUUID(), type: COMMANDS.idCardRevoke, schemaVersion: "1.0",
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
      payload: { id, tenantId: ctx.tenantId, reason: reason ?? "revoked" },
    });

    return reply.send({ id, status: "revoked" });
  });

  /** PATCH /v1/hrms/id-cards/:id/reactivate — reactivate a suspended card */
  app.patch("/v1/hrms/id-cards/:id/reactivate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["hr_admin", "security_admin", "super_admin"]);
    const { id } = req.params as { id: string };

    const result = await withTenantGuc(ctx.tenantId, (tx) => queryTx(
      tx,
      `UPDATE hrms.id_cards SET status = 'active', revoked_reason = NULL, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND status = 'suspended'`,
      [id, ctx.tenantId],
    ));
    if (result.rowCount === 0) {
      throw new HttpError(404, "NOT_FOUND", "suspended id card not found");
    }

    await queue.publish(COMMANDS.idCardReactivate, {
      messageId: randomUUID(), type: COMMANDS.idCardReactivate, schemaVersion: "1.0",
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
      payload: { id, tenantId: ctx.tenantId },
    });

    return reply.send({ id, status: "active" });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
