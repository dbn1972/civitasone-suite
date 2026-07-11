/**
 * visitor-service: device-registry zod validators (routes.ts boundary).
 *
 * Validates HTTP request bodies, path params, and query strings for the
 * hardware integration module endpoints. Enforces shape/type at the HTTP
 * boundary so malformed requests are rejected before reaching the queue.
 *
 * Requirements validated: 1.1, 1.3, 1.5, 3.1, 8.1
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared enums (aligned with domain.ts DEVICE_TYPES and status values)
// ---------------------------------------------------------------------------

const deviceTypeEnum = z.enum(["kiosk", "printer", "scanner", "turnstile", "barrier"], {
  errorMap: () => ({ message: "deviceType must be one of: kiosk, printer, scanner, turnstile, barrier" }),
});

const deviceStatusEnum = z.enum(["pending_activation", "active", "suspended", "deregistered"], {
  errorMap: () => ({ message: "status must be one of: pending_activation, active, suspended, deregistered" }),
});

// ---------------------------------------------------------------------------
// 1. registerDeviceBody — device registration request
// ---------------------------------------------------------------------------

export const registerDeviceBody = z.object({
  deviceType: deviceTypeEnum,
  name: z.string().min(1, "name is required").max(128, "name must be 128 characters or fewer"),
  serialNumber: z
    .string()
    .min(1, "serialNumber is required")
    .max(64, "serialNumber must be 64 characters or fewer")
    .regex(/^[a-zA-Z0-9-]+$/, "serialNumber must be alphanumeric with dashes only"),
  locationId: z.string().uuid("invalid locationId"),
  gateId: z.string().uuid("invalid gateId").optional(),
  capabilities: z.record(z.string(), z.array(z.string())).optional().default({}),
});
export type RegisterDeviceBody = z.infer<typeof registerDeviceBody>;

// ---------------------------------------------------------------------------
// 2. updateDeviceBody — partial device update
// ---------------------------------------------------------------------------

export const updateDeviceBody = z.object({
  name: z.string().min(1, "name is required").max(128, "name must be 128 characters or fewer").optional(),
  gateId: z.string().uuid("invalid gateId").nullable().optional(),
  capabilities: z.record(z.string(), z.array(z.string())).optional(),
});
export type UpdateDeviceBody = z.infer<typeof updateDeviceBody>;

// ---------------------------------------------------------------------------
// 3. heartbeatBody — device heartbeat payload
// ---------------------------------------------------------------------------

export const heartbeatBody = z.object({
  firmwareVersion: z
    .string()
    .min(1, "firmwareVersion is required")
    .max(32, "firmwareVersion must be 32 characters or fewer"),
  cpuUtilization: z.number().min(0, "cpuUtilization must be >= 0").max(100, "cpuUtilization must be <= 100").optional(),
  memoryUtilization: z
    .number()
    .min(0, "memoryUtilization must be >= 0")
    .max(100, "memoryUtilization must be <= 100")
    .optional(),
  peripheralStatus: z.record(z.string(), z.string()).optional(),
});
export type HeartbeatBody = z.infer<typeof heartbeatBody>;

// ---------------------------------------------------------------------------
// 4. configPushBody — config push to a single device
// ---------------------------------------------------------------------------

export const configPushBody = z.object({
  heartbeatIntervalMs: z.number().int("heartbeatIntervalMs must be an integer").positive("heartbeatIntervalMs must be positive").optional(),
  displayLanguage: z.string().optional(),
  displayBrightness: z.number().min(0, "displayBrightness must be >= 0").max(100, "displayBrightness must be <= 100").optional(),
  printerDensity: z.number().min(0, "printerDensity must be >= 0").max(15, "printerDensity must be <= 15").optional(),
  cameraResolution: z.string().optional(),
  firmwareUrl: z.string().url("firmwareUrl must be a valid URL").optional(),
  firmwareChecksum: z.string().optional(),
  custom: z.record(z.string(), z.string()).optional(),
});
export type ConfigPushBody = z.infer<typeof configPushBody>;

// ---------------------------------------------------------------------------
// 5. bulkConfigBody — bulk config push (by device type + location)
// ---------------------------------------------------------------------------

export const bulkConfigBody = z.object({
  deviceType: deviceTypeEnum,
  locationId: z.string().uuid("invalid locationId"),
  config: configPushBody,
});
export type BulkConfigBody = z.infer<typeof bulkConfigBody>;

// ---------------------------------------------------------------------------
// 6. activateDeviceParams — path parameters
// ---------------------------------------------------------------------------

export const activateDeviceParams = z.object({
  deviceId: z.string().uuid("invalid deviceId"),
});
export type ActivateDeviceParams = z.infer<typeof activateDeviceParams>;

// ---------------------------------------------------------------------------
// 7. listDevicesQuery — query parameters for listing devices
// ---------------------------------------------------------------------------

export const listDevicesQuery = z.object({
  locationId: z.string().uuid("invalid locationId").optional(),
  deviceType: deviceTypeEnum.optional(),
  status: deviceStatusEnum.optional(),
  page: z.coerce.number().int().min(1, "page must be >= 1").default(1),
  pageSize: z.coerce.number().int().min(1, "pageSize must be >= 1").max(200, "pageSize must be <= 200").default(20),
});
export type ListDevicesQuery = z.infer<typeof listDevicesQuery>;

// ---------------------------------------------------------------------------
// 8. firmwareScheduleBody — schedule firmware update for a device
// ---------------------------------------------------------------------------

export const firmwareScheduleBody = z.object({
  firmwareUrl: z.string().url("firmwareUrl must be a valid URL"),
  firmwareChecksum: z.string().min(1, "firmwareChecksum is required").max(128, "firmwareChecksum must be 128 characters or fewer"),
});
export type FirmwareScheduleBody = z.infer<typeof firmwareScheduleBody>;

// ---------------------------------------------------------------------------
// 9. deviceIdParams — common device path parameter
// ---------------------------------------------------------------------------

export const deviceIdParams = z.object({
  deviceId: z.string().uuid("invalid deviceId"),
});
export type DeviceIdParams = z.infer<typeof deviceIdParams>;

// ---------------------------------------------------------------------------
// 10. locationIdParams — location path parameter for health endpoint
// ---------------------------------------------------------------------------

export const locationIdParams = z.object({
  locationId: z.string().uuid("invalid locationId"),
});
export type LocationIdParams = z.infer<typeof locationIdParams>;

// ---------------------------------------------------------------------------
// 11. auditLogQuery — query parameters for audit log
// ---------------------------------------------------------------------------

export const auditLogQuery = z.object({
  page: z.coerce.number().int().min(1, "page must be >= 1").default(1),
  pageSize: z.coerce.number().int().min(1, "pageSize must be >= 1").max(200, "pageSize must be <= 200").default(20),
});
export type AuditLogQuery = z.infer<typeof auditLogQuery>;
