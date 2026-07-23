/**
 * inspection-service: Telemetry module — data access (repository).
 *
 * _Requirements: SVC-110_
 */
import { eq, and, sql, desc, gte, lte } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { scopedRead, type Db } from "../../shared/db.js";
import {
  devices,
  telemetryReadings,
  telemetryAlerts,
  alertRules,
  type DeviceRow,
  type DeviceInsert,
  type TelemetryReadingRow,
  type TelemetryReadingInsert,
  type TelemetryAlertRow,
  type TelemetryAlertInsert,
  type AlertRuleRow,
  type AlertRuleInsert,
} from "./schema.js";

// ── Type Aliases ──────────────────────────────────────────────────────────────

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface PaginationInput {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

// ── Device Reads ──────────────────────────────────────────────────────────────

export async function findDeviceById(
  tenantId: string,
  id: string,
): Promise<DeviceRow | null> {
  return cache.getOrLoad<DeviceRow>(
    cache.makeKey(tenantId, "telemetry-device", id),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(devices)
          .where(and(
            eq(devices.id, id),
            eq(devices.tenantId, tenantId),
          )),
      );
      return rows[0] ?? null;
    },
  );
}

export async function findDevices(
  tenantId: string,
  pagination: PaginationInput,
  filters?: {
    deviceType?: string | undefined;
    status?: string | undefined;
    entityId?: string | undefined;
  },
): Promise<PaginatedResult<DeviceRow>> {
  return scopedRead(async (tx) => {
    const conditions = [eq(devices.tenantId, tenantId)];

    if (filters?.deviceType) {
      conditions.push(eq(devices.deviceType, filters.deviceType as DeviceRow["deviceType"]));
    }
    if (filters?.status) {
      conditions.push(eq(devices.status, filters.status as DeviceRow["status"]));
    }
    if (filters?.entityId) {
      conditions.push(eq(devices.entityId, filters.entityId));
    }

    const whereClause = and(...conditions);

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(devices)
        .where(whereClause),
      tx.select().from(devices)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(desc(devices.createdAt)),
    ]);

    const total = countResult[0]?.count ?? 0;
    return { data, meta: { page: pagination.page, pageSize: pagination.pageSize, total } };
  });
}

// ── Reading Reads ─────────────────────────────────────────────────────────────

export async function findReadings(
  tenantId: string,
  pagination: PaginationInput,
  filters?: {
    deviceId?: string | undefined;
    dateFrom?: string | undefined;
    dateTo?: string | undefined;
  },
): Promise<PaginatedResult<TelemetryReadingRow>> {
  return scopedRead(async (tx) => {
    const conditions = [eq(telemetryReadings.tenantId, tenantId)];

    if (filters?.deviceId) {
      conditions.push(eq(telemetryReadings.deviceId, filters.deviceId));
    }
    if (filters?.dateFrom) {
      conditions.push(gte(telemetryReadings.capturedAt, new Date(filters.dateFrom)));
    }
    if (filters?.dateTo) {
      conditions.push(lte(telemetryReadings.capturedAt, new Date(filters.dateTo)));
    }

    const whereClause = and(...conditions);

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(telemetryReadings)
        .where(whereClause),
      tx.select().from(telemetryReadings)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(desc(telemetryReadings.capturedAt)),
    ]);

    const total = countResult[0]?.count ?? 0;
    return { data, meta: { page: pagination.page, pageSize: pagination.pageSize, total } };
  });
}

// ── Alert Reads ───────────────────────────────────────────────────────────────

export async function findAlerts(
  tenantId: string,
  pagination: PaginationInput,
  filters?: {
    status?: string | undefined;
    deviceId?: string | undefined;
    severity?: string | undefined;
  },
): Promise<PaginatedResult<TelemetryAlertRow>> {
  return scopedRead(async (tx) => {
    const conditions = [eq(telemetryAlerts.tenantId, tenantId)];

    if (filters?.status) {
      conditions.push(eq(telemetryAlerts.status, filters.status as TelemetryAlertRow["status"]));
    }
    if (filters?.deviceId) {
      conditions.push(eq(telemetryAlerts.deviceId, filters.deviceId));
    }
    if (filters?.severity) {
      conditions.push(eq(telemetryAlerts.severity, filters.severity as TelemetryAlertRow["severity"]));
    }

    const whereClause = and(...conditions);

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(telemetryAlerts)
        .where(whereClause),
      tx.select().from(telemetryAlerts)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(desc(telemetryAlerts.createdAt)),
    ]);

    const total = countResult[0]?.count ?? 0;
    return { data, meta: { page: pagination.page, pageSize: pagination.pageSize, total } };
  });
}

export async function findAlertById(
  tenantId: string,
  id: string,
): Promise<TelemetryAlertRow | null> {
  return cache.getOrLoad<TelemetryAlertRow>(
    cache.makeKey(tenantId, "telemetry-alert", id),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(telemetryAlerts)
          .where(and(
            eq(telemetryAlerts.id, id),
            eq(telemetryAlerts.tenantId, tenantId),
          )),
      );
      return rows[0] ?? null;
    },
  );
}

// ── Alert Rule Reads ──────────────────────────────────────────────────────────

export async function findActiveAlertRules(
  tenantId: string,
): Promise<AlertRuleRow[]> {
  return scopedRead((tx) =>
    tx.select().from(alertRules)
      .where(and(
        eq(alertRules.tenantId, tenantId),
        eq(alertRules.isActive, true),
      )),
  );
}

export async function findAlertRules(
  tenantId: string,
  pagination: PaginationInput,
): Promise<PaginatedResult<AlertRuleRow>> {
  return scopedRead(async (tx) => {
    const whereClause = eq(alertRules.tenantId, tenantId);

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(alertRules)
        .where(whereClause),
      tx.select().from(alertRules)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(desc(alertRules.createdAt)),
    ]);

    const total = countResult[0]?.count ?? 0;
    return { data, meta: { page: pagination.page, pageSize: pagination.pageSize, total } };
  });
}

// ── Writes ────────────────────────────────────────────────────────────────────

export async function insertDevice(
  tx: Tx,
  data: DeviceInsert,
): Promise<DeviceRow> {
  const rows = await tx.insert(devices).values(data).returning();
  return rows[0]!;
}

export async function updateDevice(
  tx: Tx,
  id: string,
  tenantId: string,
  data: Partial<Omit<DeviceInsert, "id" | "tenantId" | "createdAt" | "createdBy">>,
  expectedVersion: number,
): Promise<DeviceRow> {
  const rows = await tx.update(devices)
    .set({
      ...data,
      updatedAt: new Date(),
      version: sql`${devices.version} + 1`,
    })
    .where(and(
      eq(devices.id, id),
      eq(devices.tenantId, tenantId),
      eq(devices.version, expectedVersion),
    ))
    .returning();

  if (rows.length === 0) {
    throw new Error(`Device ${id} not found or version conflict (expected ${expectedVersion})`);
  }
  return rows[0]!;
}

export async function insertReading(
  tx: Tx,
  data: TelemetryReadingInsert,
): Promise<TelemetryReadingRow> {
  const rows = await tx.insert(telemetryReadings).values(data).returning();
  return rows[0]!;
}

export async function insertAlert(
  tx: Tx,
  data: TelemetryAlertInsert,
): Promise<TelemetryAlertRow> {
  const rows = await tx.insert(telemetryAlerts).values(data).returning();
  return rows[0]!;
}

export async function updateAlert(
  tx: Tx,
  id: string,
  tenantId: string,
  data: Partial<Omit<TelemetryAlertInsert, "id" | "tenantId" | "createdAt" | "createdBy">>,
  expectedVersion: number,
): Promise<TelemetryAlertRow> {
  const rows = await tx.update(telemetryAlerts)
    .set({
      ...data,
      updatedAt: new Date(),
      version: sql`${telemetryAlerts.version} + 1`,
    })
    .where(and(
      eq(telemetryAlerts.id, id),
      eq(telemetryAlerts.tenantId, tenantId),
      eq(telemetryAlerts.version, expectedVersion),
    ))
    .returning();

  if (rows.length === 0) {
    throw new Error(`Alert ${id} not found or version conflict (expected ${expectedVersion})`);
  }
  return rows[0]!;
}

export async function insertAlertRule(
  tx: Tx,
  data: AlertRuleInsert,
): Promise<AlertRuleRow> {
  const rows = await tx.insert(alertRules).values(data).returning();
  return rows[0]!;
}
