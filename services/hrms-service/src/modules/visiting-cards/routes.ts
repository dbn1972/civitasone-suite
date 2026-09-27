import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { resolveContext, HttpError } from "../../shared/context.js";
import { sqlPool as sqlClient, sqlClient as rawSqlClient } from "../../shared/db.js";
import { withRawTenantGuc } from "@civitasone/db";

/**
 * Audit: employee.hrms_employees and hrms.visiting_cards are both FORCE ROW
 * LEVEL SECURITY (tenant_isolation_policy). Plain sqlClient.query() (==
 * sqlPool, see shared/db.ts) runs on a pooled connection with no app.tenant_id
 * GUC set, so under hrms_svc (NOBYPASSRLS) every policy fails CLOSED. Wrapped
 * every authenticated route below (GET/PATCH .../me, .../me/share,
 * .../me/signature) the same way social/routes.ts's withTenantGuc already
 * does elsewhere in this service.
 *
 * IMPORTANT -- this fix alone does NOT make these routes work end-to-end.
 * Independently of the RLS gap, every query below that touches
 * employee.hrms_employees references columns that do not exist on the real
 * table (confirmed live): first_name, last_name, designation, department,
 * phone, employee_code, photo_url, branch, and the WHERE-clause user_id are
 * all either missing or misnamed -- the real table has full_name (one
 * field), mobile, photo_key, user_ref, and department_id/designation_id as
 * uuid FKs (no plain-text department/designation column at all; no
 * employee_code equivalent; no branch column). GET .../me additionally joins
 * public.tenants, which does not exist under any name. So today every route
 * here 500s with "column ... does not exist" before RLS is ever reached,
 * both before and after this fix -- this is a separate, deeper, pre-existing
 * defect (wrong/missing columns, not a tenant-scoping gap), out of scope for
 * a "swap in the right tenant-scoping call" fix: rendering designation/
 * department as text needs a join to hrms_designations/hrms_departments,
 * there's no established employee_code/branch equivalent to fall back to,
 * and dropping the tenants join changes the response shape. Left every query
 * exactly as originally written (columns and all) and applied only the GUC
 * wrap, so the tenant-scoping half of the fix is already correct and in
 * place once this file's column references get their own dedicated fix
 * (same shape as PR #1592's "stop 4 HRMS endpoints 500ing on wrong table/
 * schema references"). Flagged in full in the PR description; not fixed
 * here.
 *
 * GET /visiting-card/public/:code is, on top of the above, ALSO not wrapped
 * in withTenantGuc: it has no auth and no ctx.tenantId at all (that is the
 * point -- a QR scan has to resolve an employee_code to a card without
 * knowing the tenant up front), so even setting the column issue aside this
 * isn't the "swap in the right tenant-scoping call" shape -- it is the same
 * cross-tenant-discovery problem PR #1626 hit in scheduler/tick.ts, which
 * that fix resolved via scopedPlatformRead (migration 0133's
 * app.platform_bypass SELECT policy) for the Drizzle surface. Nothing here
 * builds a raw-sqlClient equivalent of that policy read, so the route is
 * left exactly as-is rather than bolting on a new, unreviewed cross-tenant
 * bypass for a public/no-auth endpoint. Flagged in the PR description as a
 * recommended follow-up.
 */
function withTenantGuc<T>(
  tenantId: string,
  fn: (pool: {
    query<R = any>(text: string, params?: readonly unknown[]): Promise<{ rows: R[]; rowCount: number }>;
  }) => Promise<T>,
): Promise<T> {
  return withRawTenantGuc(rawSqlClient, tenantId, async (tx) => {
    const pool = {
      async query<R = any>(text: string, params: readonly unknown[] = []): Promise<{ rows: R[]; rowCount: number }> {
        const result = await tx.unsafe(text, params as unknown as never[]);
        const rows = result as unknown as R[];
        const rowCount = (result as unknown as { count?: number }).count ?? rows.length;
        return { rows, rowCount };
      },
    };
    return fn(pool);
  });
}

/**
 * Digital Visiting Card Module.
 *
 * Every employee gets a professional digital visiting card that can be:
 * - Viewed on mobile (beautiful gradient card with QR)
 * - Shared as vCard (.vcf) file → imports into any phone contacts
 * - Shared as image (card snapshot via WhatsApp/email)
 * - Scanned via QR → opens vCard download link
 * - Tracked (scan/share analytics)
 *
 * Designation-based card tiers:
 * - Secretary/DG/CEO → Gold gradient
 * - Director/Joint Secretary → Silver gradient
 * - Deputy Director/Under Secretary → Blue gradient
 * - Standard officer/staff → Indigo gradient
 */

const updateCardSchema = z.object({
  displayName: z.string().min(2).max(100).optional(),
  suffix: z.string().max(50).optional(), // e.g. "IAS", "PhD", "MBBS"
  title: z.string().max(100).optional(), // override designation display
  phone: z.string().max(20).optional(),
  altPhone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  altEmail: z.string().email().optional(),
  website: z.string().url().optional(),
  linkedIn: z.string().url().optional(),
  twitter: z.string().max(50).optional(),
  address: z.string().max(300).optional(),
  tagline: z.string().max(150).optional(), // e.g. "Digital India Corporation, MeitY"
  showPersonalPhone: z.boolean().optional(),
  cardTier: z.enum(["gold", "silver", "blue", "indigo", "emerald"]).optional(),
});

export async function visitingCardRoutes(app: FastifyInstance): Promise<void> {

  // ─── GET MY VISITING CARD ─────────────────────────────────────────────

  /** GET /v1/hrms/visiting-card/me — my digital visiting card */
  app.get("/v1/hrms/visiting-card/me", async (req, reply) => {
    const ctx = resolveContext(req);

    // Get employee profile
    const emp = await withTenantGuc(ctx.tenantId, (pool) => pool.query(
      `SELECT e.id, e.first_name, e.last_name, e.designation, e.department, e.email,
              e.phone, e.employee_code, e.photo_url, e.branch,
              vc.display_name, vc.suffix, vc.title_override, vc.alt_phone, vc.alt_email,
              vc.website, vc.linkedin, vc.twitter, vc.address, vc.tagline,
              vc.show_personal_phone, vc.card_tier, vc.share_count, vc.scan_count,
              t.name AS org_name
       FROM employee.hrms_employees e
       LEFT JOIN hrms.visiting_cards vc ON vc.employee_id = e.id AND vc.tenant_id = e.tenant_id
       LEFT JOIN public.tenants t ON t.id = e.tenant_id
       WHERE e.user_id = $1 AND e.tenant_id = $2`,
      [ctx.actorId, ctx.tenantId],
    ));

    if (emp.rowCount === 0) throw new HttpError(404, "NOT_FOUND", "Employee not found");
    const e = emp.rows[0];

    const name = e.display_name || `${e.first_name} ${e.last_name}`.trim();
    const tier = e.card_tier || inferTier(e.designation ?? "");
    const orgName = e.org_name || e.department || "";

    // Generate vCard string
    const vcard = generateVCard({
      name: name,
      suffix: e.suffix,
      title: e.title_override || e.designation,
      org: orgName,
      department: e.department,
      phone: e.phone,
      altPhone: e.show_personal_phone ? e.alt_phone : undefined,
      email: e.email,
      altEmail: e.alt_email,
      website: e.website,
      address: e.address,
      photoUrl: e.photo_url,
    });

    // QR payload — URL to download vCard
    const qrUrl = `https://cards.civitasone.gov.in/v/${e.employee_code}`;

    return reply.send({
      data: {
        id: e.id,
        name,
        suffix: e.suffix,
        designation: e.title_override || e.designation,
        department: e.department,
        orgName,
        branch: e.branch,
        employeeCode: e.employee_code,
        phone: e.phone,
        altPhone: e.alt_phone,
        email: e.email,
        altEmail: e.alt_email,
        website: e.website,
        linkedIn: e.linkedin,
        twitter: e.twitter,
        address: e.address,
        tagline: e.tagline,
        photoUrl: e.photo_url,
        cardTier: tier,
        shareCount: e.share_count ?? 0,
        scanCount: e.scan_count ?? 0,
        qrUrl,
        vcardText: vcard,
      },
    });
  });

  // ─── UPDATE CARD PREFERENCES ──────────────────────────────────────────

  /** PATCH /v1/hrms/visiting-card/me — customize my card */
  app.patch("/v1/hrms/visiting-card/me", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = updateCardSchema.parse(req.body);

    // Get employee ID
    const empRow = await withTenantGuc(ctx.tenantId, (pool) => pool.query(
      `SELECT id FROM employee.hrms_employees WHERE user_id = $1 AND tenant_id = $2`,
      [ctx.actorId, ctx.tenantId],
    ));
    if (empRow.rowCount === 0) throw new HttpError(404, "NOT_FOUND", "Employee not found");
    const employeeId = empRow.rows[0].id;

    // Upsert visiting card preferences
    await withTenantGuc(ctx.tenantId, (pool) => pool.query(
      `INSERT INTO hrms.visiting_cards (id, tenant_id, employee_id, display_name, suffix, title_override,
        alt_phone, alt_email, website, linkedin, twitter, address, tagline, show_personal_phone, card_tier, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
       ON CONFLICT (tenant_id, employee_id) DO UPDATE SET
        display_name = COALESCE($4, hrms.visiting_cards.display_name),
        suffix = COALESCE($5, hrms.visiting_cards.suffix),
        title_override = COALESCE($6, hrms.visiting_cards.title_override),
        alt_phone = COALESCE($7, hrms.visiting_cards.alt_phone),
        alt_email = COALESCE($8, hrms.visiting_cards.alt_email),
        website = COALESCE($9, hrms.visiting_cards.website),
        linkedin = COALESCE($10, hrms.visiting_cards.linkedin),
        twitter = COALESCE($11, hrms.visiting_cards.twitter),
        address = COALESCE($12, hrms.visiting_cards.address),
        tagline = COALESCE($13, hrms.visiting_cards.tagline),
        show_personal_phone = COALESCE($14, hrms.visiting_cards.show_personal_phone),
        card_tier = COALESCE($15, hrms.visiting_cards.card_tier),
        updated_at = NOW()`,
      [
        randomUUID(), ctx.tenantId, employeeId,
        body.displayName ?? null, body.suffix ?? null, body.title ?? null,
        body.altPhone ?? null, body.altEmail ?? null, body.website ?? null,
        body.linkedIn ?? null, body.twitter ?? null, body.address ?? null,
        body.tagline ?? null, body.showPersonalPhone ?? null, body.cardTier ?? null,
      ],
    ));

    return reply.send({ status: "updated" });
  });

  // ─── PUBLIC vCard DOWNLOAD (no auth — shared via QR/link) ─────────────

  /** GET /v1/hrms/visiting-card/public/:code — download vCard by employee code */
  app.get("/v1/hrms/visiting-card/public/:code", async (req, reply) => {
    const { code } = req.params as { code: string };

    const emp = await sqlClient.query(
      `SELECT e.first_name, e.last_name, e.designation, e.department, e.email, e.phone, e.photo_url,
              vc.display_name, vc.suffix, vc.title_override, vc.alt_phone, vc.alt_email,
              vc.website, vc.address, vc.tagline, vc.show_personal_phone, e.id AS emp_id, e.tenant_id
       FROM employee.hrms_employees e
       LEFT JOIN hrms.visiting_cards vc ON vc.employee_id = e.id AND vc.tenant_id = e.tenant_id
       WHERE e.employee_code = $1 AND e.status = 'active'`,
      [code],
    );

    if (emp.rowCount === 0) {
      return reply.code(404).send({ error: "Card not found" });
    }

    const e = emp.rows[0];
    const name = e.display_name || `${e.first_name} ${e.last_name}`.trim();

    // Increment scan count
    await sqlClient.query(
      `UPDATE hrms.visiting_cards SET scan_count = COALESCE(scan_count, 0) + 1 WHERE employee_id = $1 AND tenant_id = $2`,
      [e.emp_id, e.tenant_id],
    );

    const vcard = generateVCard({
      name,
      suffix: e.suffix,
      title: e.title_override || e.designation,
      org: e.department,
      phone: e.phone,
      altPhone: e.show_personal_phone ? e.alt_phone : undefined,
      email: e.email,
      altEmail: e.alt_email,
      website: e.website,
      address: e.address,
      photoUrl: e.photo_url,
    });

    // Return as downloadable .vcf file
    reply.header("Content-Type", "text/vcard; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${name.replace(/\s+/g, '_')}.vcf"`);
    return reply.send(vcard);
  });

  // ─── RECORD SHARE EVENT ───────────────────────────────────────────────

  /** POST /v1/hrms/visiting-card/me/share — record that card was shared */
  app.post("/v1/hrms/visiting-card/me/share", async (req, reply) => {
    const ctx = resolveContext(req);
    const { method } = (req.body as any) ?? {}; // whatsapp, email, qr, nfc, copy

    const empRow = await withTenantGuc(ctx.tenantId, (pool) => pool.query(
      `SELECT id FROM employee.hrms_employees WHERE user_id = $1 AND tenant_id = $2`,
      [ctx.actorId, ctx.tenantId],
    ));
    if (empRow.rowCount === 0) return reply.send({ status: "ok" });

    await withTenantGuc(ctx.tenantId, (pool) => pool.query(
      `UPDATE hrms.visiting_cards SET share_count = COALESCE(share_count, 0) + 1 WHERE employee_id = $1 AND tenant_id = $2`,
      [empRow.rows[0].id, ctx.tenantId],
    ));

    return reply.send({ status: "shared", method: method ?? "unknown" });
  });

  // ─── EMAIL SIGNATURE GENERATOR ────────────────────────────────────────

  /** GET /v1/hrms/visiting-card/me/signature — HTML email signature */
  app.get("/v1/hrms/visiting-card/me/signature", async (req, reply) => {
    const ctx = resolveContext(req);

    const emp = await withTenantGuc(ctx.tenantId, (pool) => pool.query(
      `SELECT e.first_name, e.last_name, e.designation, e.department, e.email, e.phone, e.photo_url,
              vc.display_name, vc.suffix, vc.title_override, vc.website, vc.linkedin, vc.tagline
       FROM employee.hrms_employees e
       LEFT JOIN hrms.visiting_cards vc ON vc.employee_id = e.id AND vc.tenant_id = e.tenant_id
       WHERE e.user_id = $1 AND e.tenant_id = $2`,
      [ctx.actorId, ctx.tenantId],
    ));
    if (emp.rowCount === 0) throw new HttpError(404, "NOT_FOUND", "Employee not found");
    const e = emp.rows[0];
    const name = e.display_name || `${e.first_name} ${e.last_name}`.trim();
    const title = e.title_override || e.designation;
    const suffix = e.suffix ? `, ${e.suffix}` : "";

    const html = `<table cellpadding="0" cellspacing="0" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#1e293b;">
  <tr><td style="padding-bottom:8px;border-bottom:2px solid #6366f1;">
    <strong style="font-size:15px;color:#1e293b;">${name}${suffix}</strong><br/>
    <span style="color:#64748b;">${title}</span><br/>
    <span style="color:#64748b;">${e.department}</span>
  </td></tr>
  <tr><td style="padding-top:8px;">
    ${e.phone ? `<span>📱 ${e.phone}</span><br/>` : ""}
    ${e.email ? `<span>✉️ <a href="mailto:${e.email}" style="color:#6366f1;text-decoration:none;">${e.email}</a></span><br/>` : ""}
    ${e.website ? `<span>🌐 <a href="${e.website}" style="color:#6366f1;text-decoration:none;">${e.website}</a></span><br/>` : ""}
    ${e.linkedin ? `<span>🔗 <a href="${e.linkedin}" style="color:#6366f1;text-decoration:none;">LinkedIn</a></span>` : ""}
  </td></tr>
  ${e.tagline ? `<tr><td style="padding-top:6px;font-size:11px;color:#94a3b8;font-style:italic;">${e.tagline}</td></tr>` : ""}
</table>`;

    return reply.send({ html, plainText: `${name}${suffix}\n${title}\n${e.department}\n${e.phone ?? ""}\n${e.email ?? ""}` });
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function inferTier(designation: string): string {
  const d = designation.toLowerCase();
  if (d.includes("secretary") || d.includes("ceo") || d.includes("director general") || d.includes("chairman")) return "gold";
  if (d.includes("director") || d.includes("joint secretary") || d.includes("cto") || d.includes("cfo")) return "silver";
  if (d.includes("deputy") || d.includes("under secretary") || d.includes("senior")) return "blue";
  if (d.includes("manager") || d.includes("lead") || d.includes("head")) return "indigo";
  return "indigo";
}

function generateVCard(opts: {
  name: string;
  suffix?: string;
  title?: string;
  org?: string;
  department?: string;
  phone?: string;
  altPhone?: string;
  email?: string;
  altEmail?: string;
  website?: string;
  address?: string;
  photoUrl?: string;
}): string {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${opts.name}${opts.suffix ? `, ${opts.suffix}` : ""}`,
    `N:${opts.name.split(" ").reverse().join(";")};;;${opts.suffix ?? ""}`,
  ];

  if (opts.title) lines.push(`TITLE:${opts.title}`);
  if (opts.org) {
    // ORG format: Company;Department
    const orgLine = opts.department && opts.department !== opts.org
      ? `${opts.org};${opts.department}`
      : opts.org;
    lines.push(`ORG:${orgLine}`);
  }
  if (opts.phone) lines.push(`TEL;TYPE=WORK:${opts.phone}`);
  if (opts.altPhone) lines.push(`TEL;TYPE=CELL:${opts.altPhone}`);
  if (opts.email) lines.push(`EMAIL;TYPE=WORK:${opts.email}`);
  if (opts.altEmail) lines.push(`EMAIL;TYPE=HOME:${opts.altEmail}`);
  if (opts.website) lines.push(`URL:${opts.website}`);
  if (opts.address) lines.push(`ADR;TYPE=WORK:;;${opts.address.replace(/\n/g, ";")}`);
  if (opts.photoUrl) lines.push(`PHOTO;TYPE=JPEG;VALUE=URI:${opts.photoUrl}`);

  lines.push("END:VCARD");
  return lines.join("\r\n");
}
