import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { sqlPool as sqlClient } from "../../shared/db.js";

/**
 * Device Trust & Compliance Module.
 *
 * NOT MDM — lightweight app-level device inventory and compliance for admins.
 *
 * What it does:
 * 1. App reports device info (OS, rooted status, screen lock, biometric) on every login
 * 2. Admin sees all devices accessing org data — who, what device, last active
 * 3. Admin can block a specific device (lost phone, terminated employee, compromised)
 * 4. Auto-flag non-compliant devices (rooted, no screen lock, outdated OS)
 * 5. Compliance policies configurable per tenant
 */

const deviceReportSchema = z.object({
  deviceId: z.string().min(5),
  deviceName: z.string().max(100),
  platform: z.enum(["android", "ios", "web"]),
  osVersion: z.string().max(30),
  appVersion: z.string().max(20),
  isRooted: z.boolean().optional(),
  hasScreenLock: z.boolean().optional(),
  isEncrypted: z.boolean().optional(),
  biometricAvailable: z.boolean().optional(),
});

const policyUpdateSchema = z.object({
  minOsVersionAndroid: z.string().max(10).optional(),
  minOsVersionIos: z.string().max(10).optional(),
  minAppVersion: z.string().max(20).optional(),
  blockRooted: z.boolean().optional(),
  requireScreenLock: z.boolean().optional(),
  requireBiometric: z.boolean().optional(),
  maxInactiveDays: z.number().int().min(7).max(365).optional(),
});

export async function deviceTrustRoutes(app: FastifyInstance): Promise<void> {

  // ─── DEVICE HEARTBEAT (called by mobile app on login/sync) ────────────

  /** POST /v1/hrms/devices/heartbeat — report device info + compliance state */
  app.post("/v1/hrms/devices/heartbeat", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = deviceReportSchema.parse(req.body);
    const now = new Date().toISOString();
    const ip = req.ip ?? "";

    // Check if device is blocked
    const existing = await sqlClient.query(
      `SELECT trust_status, blocked_reason FROM hrms.trusted_devices
       WHERE tenant_id = $1 AND user_id = $2 AND device_id = $3`,
      [ctx.tenantId, ctx.actorId, body.deviceId],
    );

    if (existing.rows[0]?.trust_status === "blocked") {
      return reply.code(403).send({
        code: "DEVICE_BLOCKED",
        message: `This device has been blocked. Reason: ${existing.rows[0].blocked_reason ?? "Contact admin"}`,
      });
    }

    // Check compliance against tenant policy
    const policy = await getPolicy(ctx.tenantId);
    const flags: string[] = [];

    if (policy.blockRooted && body.isRooted) flags.push("rooted");
    if (policy.requireScreenLock && body.hasScreenLock === false) flags.push("no_screen_lock");
    if (policy.requireBiometric && body.biometricAvailable === false) flags.push("no_biometric");

    // OS version check (simple numeric comparison)
    if (body.platform === "android") {
      const ver = parseInt(body.osVersion.replace(/\D/g, "").slice(0, 2), 10);
      const min = parseInt(policy.minOsVersionAndroid, 10);
      if (ver > 0 && min > 0 && ver < min) flags.push("outdated_os");
    } else if (body.platform === "ios") {
      const ver = parseInt(body.osVersion.replace(/\D/g, "").slice(0, 2), 10);
      const min = parseInt(policy.minOsVersionIos, 10);
      if (ver > 0 && min > 0 && ver < min) flags.push("outdated_os");
    }

    const trustStatus = flags.length > 0
      ? (flags.includes("rooted") ? "blocked" : "flagged")
      : "trusted";

    // Upsert device record
    await sqlClient.query(
      `INSERT INTO hrms.trusted_devices (id, tenant_id, user_id, device_id, device_name, platform,
        os_version, app_version, is_rooted, has_screen_lock, is_encrypted, biometric_available,
        trust_status, flagged_reason, last_seen_at, last_ip, login_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 1)
       ON CONFLICT (tenant_id, user_id, device_id) DO UPDATE SET
        device_name = $5, os_version = $7, app_version = $8,
        is_rooted = $9, has_screen_lock = $10, is_encrypted = $11, biometric_available = $12,
        trust_status = CASE WHEN hrms.trusted_devices.trust_status = 'blocked' THEN 'blocked' ELSE $13 END,
        flagged_reason = $14, last_seen_at = $15, last_ip = $16,
        login_count = hrms.trusted_devices.login_count + 1`,
      [
        randomUUID(), ctx.tenantId, ctx.actorId, body.deviceId,
        body.deviceName, body.platform, body.osVersion, body.appVersion,
        body.isRooted ?? false, body.hasScreenLock ?? true,
        body.isEncrypted ?? true, body.biometricAvailable ?? false,
        trustStatus, flags.length > 0 ? flags.join(", ") : null,
        now, ip,
      ],
    );

    // SEC: Enforce max device limit (3 devices per user) — prevent credential sharing
    const MAX_DEVICES_PER_USER = 3;
    const activeDevices = await sqlClient.query(
      `SELECT COUNT(*)::int AS count FROM hrms.trusted_devices
       WHERE tenant_id = $1 AND user_id = $2 AND trust_status = 'trusted'`,
      [ctx.tenantId, ctx.actorId],
    );
    if ((activeDevices.rows[0]?.count ?? 0) > MAX_DEVICES_PER_USER) {
      // Auto-block the oldest device (not the current one)
      await sqlClient.query(
        `UPDATE hrms.trusted_devices SET trust_status = 'blocked', blocked_reason = 'max_devices_exceeded'
         WHERE id = (
           SELECT id FROM hrms.trusted_devices
           WHERE tenant_id = $1 AND user_id = $2 AND trust_status = 'trusted' AND device_id != $3
           ORDER BY last_seen_at ASC LIMIT 1
         )`,
        [ctx.tenantId, ctx.actorId, body.deviceId],
      );
    }

    // Log activity
    await sqlClient.query(
      `INSERT INTO hrms.device_activity_log (tenant_id, device_id, user_id, event_type, metadata, ip_address)
       VALUES ($1, $2, $3, 'heartbeat', $4, $5)`,
      [ctx.tenantId, body.deviceId, ctx.actorId, JSON.stringify({ flags, appVersion: body.appVersion }), ip],
    );

    // If rooted and policy says block → deny access
    if (trustStatus === "blocked") {
      return reply.code(403).send({
        code: "DEVICE_NON_COMPLIANT",
        message: "This device does not meet security requirements. Reason: " + flags.join(", "),
        flags,
      });
    }

    return reply.send({
      trustStatus,
      flags,
      compliant: flags.length === 0,
    });
  });

  // ─── ADMIN: LIST ALL DEVICES ──────────────────────────────────────────

  /** GET /v1/hrms/devices/admin — all devices accessing org data */
  app.get("/v1/hrms/devices/admin", async (req, reply) => {
    const ctx = resolveContext(req);
    const { status, platform, search } = req.query as { status?: string; platform?: string; search?: string };

    let where = "WHERE d.tenant_id = $1";
    const params: any[] = [ctx.tenantId];
    let idx = 2;

    if (status) { where += ` AND d.trust_status = $${idx++}`; params.push(status); }
    if (platform) { where += ` AND d.platform = $${idx++}`; params.push(platform); }
    if (search) { where += ` AND (d.device_name ILIKE $${idx} OR e.first_name ILIKE $${idx} OR e.last_name ILIKE $${idx})`; params.push(`%${search}%`); idx++; }

    const rows = await sqlClient.query(
      `SELECT d.id, d.device_id, d.device_name, d.platform, d.os_version, d.app_version,
              d.is_rooted, d.has_screen_lock, d.biometric_available, d.trust_status,
              d.flagged_reason, d.first_seen_at, d.last_seen_at, d.last_ip, d.login_count,
              e.first_name, e.last_name, e.employee_code, e.department
       FROM hrms.trusted_devices d
       LEFT JOIN employee.hrms_employees e ON e.user_id = d.user_id AND e.tenant_id = d.tenant_id
       ${where}
       ORDER BY d.last_seen_at DESC LIMIT 200`,
      params,
    );

    return reply.send({
      data: rows.rows.map((r: any) => ({
        id: r.id,
        deviceId: r.device_id,
        deviceName: r.device_name,
        platform: r.platform,
        osVersion: r.os_version,
        appVersion: r.app_version,
        isRooted: r.is_rooted,
        hasScreenLock: r.has_screen_lock,
        biometricAvailable: r.biometric_available,
        trustStatus: r.trust_status,
        flaggedReason: r.flagged_reason,
        firstSeen: r.first_seen_at,
        lastSeen: r.last_seen_at,
        lastIp: r.last_ip,
        loginCount: r.login_count,
        employeeName: r.first_name ? `${r.first_name} ${r.last_name}`.trim() : "Unknown",
        employeeCode: r.employee_code,
        department: r.department,
      })),
    });
  });

  // ─── ADMIN: BLOCK DEVICE ──────────────────────────────────────────────

  /** PATCH /v1/hrms/devices/:id/block — block a specific device */
  app.patch("/v1/hrms/devices/:id/block", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["hr_admin", "it_admin", "super_admin"]);
    const { id } = req.params as { id: string };
    const { reason } = (req.body as any) ?? {};

    await sqlClient.query(
      `UPDATE hrms.trusted_devices SET trust_status = 'blocked', blocked_by = $1, blocked_at = NOW(), blocked_reason = $2
       WHERE id = $3 AND tenant_id = $4`,
      [ctx.actorId, reason ?? "Blocked by admin", id, ctx.tenantId],
    );

    // Log the block event
    const device = await sqlClient.query(`SELECT device_id, user_id FROM hrms.trusted_devices WHERE id = $1`, [id]);
    if (device.rows[0]) {
      await sqlClient.query(
        `INSERT INTO hrms.device_activity_log (tenant_id, device_id, user_id, event_type, metadata, ip_address)
         VALUES ($1, $2, $3, 'blocked', $4, $5)`,
        [ctx.tenantId, device.rows[0].device_id, device.rows[0].user_id, JSON.stringify({ reason, blockedBy: ctx.actorId }), req.ip],
      );
    }

    return reply.send({ id, status: "blocked" });
  });

  // ─── ADMIN: UNBLOCK DEVICE ────────────────────────────────────────────

  /** PATCH /v1/hrms/devices/:id/unblock — restore access */
  app.patch("/v1/hrms/devices/:id/unblock", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["hr_admin", "it_admin", "super_admin"]);
    const { id } = req.params as { id: string };

    await sqlClient.query(
      `UPDATE hrms.trusted_devices SET trust_status = 'trusted', blocked_by = NULL, blocked_at = NULL, blocked_reason = NULL
       WHERE id = $1 AND tenant_id = $2 AND trust_status = 'blocked'`,
      [id, ctx.tenantId],
    );

    return reply.send({ id, status: "trusted" });
  });

  // ─── ADMIN: DEVICE ACTIVITY LOG ───────────────────────────────────────

  /** GET /v1/hrms/devices/:deviceId/activity — activity log for a device */
  app.get("/v1/hrms/devices/:deviceId/activity", async (req, reply) => {
    const ctx = resolveContext(req);
    const { deviceId } = req.params as { deviceId: string };

    const rows = await sqlClient.query(
      `SELECT event_type, metadata, ip_address, created_at
       FROM hrms.device_activity_log
       WHERE tenant_id = $1 AND device_id = $2
       ORDER BY created_at DESC LIMIT 50`,
      [ctx.tenantId, deviceId],
    );

    return reply.send({ data: rows.rows });
  });

  // ─── ADMIN: COMPLIANCE POLICY ─────────────────────────────────────────

  /** GET /v1/hrms/devices/policy — current compliance policy */
  app.get("/v1/hrms/devices/policy", async (req, reply) => {
    const ctx = resolveContext(req);
    const policy = await getPolicy(ctx.tenantId);
    return reply.send({ data: policy });
  });

  /** PATCH /v1/hrms/devices/policy — update compliance policy */
  app.patch("/v1/hrms/devices/policy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["hr_admin", "it_admin", "super_admin"]);
    const body = policyUpdateSchema.parse(req.body);

    await sqlClient.query(
      `INSERT INTO hrms.device_policies (tenant_id, min_os_version_android, min_os_version_ios,
        min_app_version, block_rooted, require_screen_lock, require_biometric, max_inactive_days, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (tenant_id) DO UPDATE SET
        min_os_version_android = COALESCE($2, hrms.device_policies.min_os_version_android),
        min_os_version_ios = COALESCE($3, hrms.device_policies.min_os_version_ios),
        min_app_version = COALESCE($4, hrms.device_policies.min_app_version),
        block_rooted = COALESCE($5, hrms.device_policies.block_rooted),
        require_screen_lock = COALESCE($6, hrms.device_policies.require_screen_lock),
        require_biometric = COALESCE($7, hrms.device_policies.require_biometric),
        max_inactive_days = COALESCE($8, hrms.device_policies.max_inactive_days),
        updated_at = NOW()`,
      [
        ctx.tenantId,
        body.minOsVersionAndroid ?? null, body.minOsVersionIos ?? null,
        body.minAppVersion ?? null, body.blockRooted ?? null,
        body.requireScreenLock ?? null, body.requireBiometric ?? null,
        body.maxInactiveDays ?? null,
      ],
    );

    return reply.send({ status: "updated" });
  });

  // ─── MY DEVICES (employee self-service) ───────────────────────────────

  /** GET /v1/hrms/devices/me — list my registered devices */
  app.get("/v1/hrms/devices/me", async (req, reply) => {
    const ctx = resolveContext(req);

    const rows = await sqlClient.query(
      `SELECT id, device_id, device_name, platform, os_version, app_version,
              trust_status, flagged_reason, first_seen_at, last_seen_at, login_count
       FROM hrms.trusted_devices
       WHERE tenant_id = $1 AND user_id = $2
       ORDER BY last_seen_at DESC`,
      [ctx.tenantId, ctx.actorId],
    );

    return reply.send({ data: rows.rows });
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

// ─── Helper ─────────────────────────────────────────────────────────────────

type Policy = {
  minOsVersionAndroid: string;
  minOsVersionIos: string;
  minAppVersion: string;
  blockRooted: boolean;
  requireScreenLock: boolean;
  requireBiometric: boolean;
  maxInactiveDays: number;
};

async function getPolicy(tenantId: string): Promise<Policy> {
  const row = await sqlClient.query(
    `SELECT min_os_version_android, min_os_version_ios, min_app_version,
            block_rooted, require_screen_lock, require_biometric, max_inactive_days
     FROM hrms.device_policies WHERE tenant_id = $1`,
    [tenantId],
  );

  if (row.rowCount === 0) {
    return {
      minOsVersionAndroid: "12",
      minOsVersionIos: "16",
      minAppVersion: "0.1.0",
      blockRooted: true,
      requireScreenLock: true,
      requireBiometric: false,
      maxInactiveDays: 90,
    };
  }

  const p = row.rows[0];
  return {
    minOsVersionAndroid: p.min_os_version_android,
    minOsVersionIos: p.min_os_version_ios,
    minAppVersion: p.min_app_version,
    blockRooted: p.block_rooted,
    requireScreenLock: p.require_screen_lock,
    requireBiometric: p.require_biometric,
    maxInactiveDays: p.max_inactive_days,
  };
}
