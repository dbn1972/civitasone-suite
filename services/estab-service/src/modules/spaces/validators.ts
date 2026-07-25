import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });

// ── Inventory ──────────────────────────────────────────────────────────────
export const createBuildingBody = z.object({
  code:    z.string().min(1).max(64),
  name:    z.string().min(1).max(200),
  address: z.string().max(512).optional(),
  orgUnit: z.string().max(64).optional(),
});
export type CreateBuildingBody = z.infer<typeof createBuildingBody>;

export const createFloorBody = z.object({
  buildingId: z.string().uuid(),
  floorNo:    z.number().int(),
  name:       z.string().max(120).optional(),
});
export type CreateFloorBody = z.infer<typeof createFloorBody>;

export const roomType = z.enum(["office", "cabin", "conference", "store", "utility"]);
export const createRoomBody = z.object({
  floorId:  z.string().uuid(),
  roomNo:   z.string().min(1).max(64),
  name:     z.string().max(120).optional(),
  roomType: roomType.default("office"),
  capacity: z.number().int().nonnegative().default(1),
});
export type CreateRoomBody = z.infer<typeof createRoomBody>;

export const seatType = z.enum(["workstation", "cabin", "hot_desk", "cubicle"]);
export const createSeatBody = z.object({
  roomId:   z.string().uuid(),
  seatNo:   z.string().min(1).max(64),
  seatType: seatType.default("workstation"),
});
export type CreateSeatBody = z.infer<typeof createSeatBody>;

// ── Allotment ──────────────────────────────────────────────────────────────
export const requestAllotmentBody = z
  .object({
    targetType:  z.enum(["seat", "room"]),
    targetId:    z.string().uuid(),
    employeeRef: z.string().uuid().optional(),
    orgUnit:     z.string().max(64).optional(),
    purpose:     z.string().max(500).optional(),
  })
  .refine((b) => b.employeeRef !== undefined || b.orgUnit !== undefined, {
    message: "either employeeRef or orgUnit is required",
    path: ["employeeRef"],
  });
export type RequestAllotmentBody = z.infer<typeof requestAllotmentBody>;

export const allotBody = z.object({
  version:          z.number().int().positive(),
  licenceFeeMinor:  z.number().int().nonnegative().default(0),
  currency:         z.string().length(3).default("INR"),
});
export type AllotBody = z.infer<typeof allotBody>;

export const versionBody = z.object({ version: z.number().int().positive() });
export type VersionBody = z.infer<typeof versionBody>;

export const releaseBody = z.object({
  version: z.number().int().positive(),
  reason:  z.string().max(500).optional(),
});
export type ReleaseBody = z.infer<typeof releaseBody>;

export const cancelBody = z.object({
  version: z.number().int().positive(),
  reason:  z.string().max(500).optional(),
});
export type CancelBody = z.infer<typeof cancelBody>;

// ── Maintenance ────────────────────────────────────────────────────────────
export const createMaintenanceBody = z.object({
  assetType:   z.enum(["building", "floor", "room", "seat"]),
  assetId:     z.string().uuid(),
  category:    z.enum(["electrical", "plumbing", "carpentry", "hvac", "it", "civil", "other"]).default("other"),
  priority:    z.enum(["low", "medium", "high", "critical"]).default("medium"),
  description: z.string().min(1).max(2000),
});
export type CreateMaintenanceBody = z.infer<typeof createMaintenanceBody>;

export const maintenanceStatusBody = z.object({
  version:         z.number().int().positive(),
  status:          z.enum(["open", "assigned", "in_progress", "resolved", "closed", "cancelled"]),
  assignedTo:      z.string().uuid().optional(),
  resolutionNotes: z.string().max(2000).optional(),
});
export type MaintenanceStatusBody = z.infer<typeof maintenanceStatusBody>;

// ── Query params ───────────────────────────────────────────────────────────
export const listQuery = z.object({
  status: z.string().max(24).optional(),
  limit:  z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export const floorsQuery = z.object({
  buildingId: z.string().uuid().optional(),
  limit:      z.coerce.number().int().positive().max(200).default(50),
  offset:     z.coerce.number().int().nonnegative().default(0),
});

export const roomsQuery = z.object({
  floorId: z.string().uuid().optional(),
  limit:   z.coerce.number().int().positive().max(200).default(50),
  offset:  z.coerce.number().int().nonnegative().default(0),
});

export const seatsQuery = z.object({
  roomId: z.string().uuid().optional(),
  status: z.string().max(24).optional(),
  limit:  z.coerce.number().int().positive().max(500).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export const availabilityQuery = z
  .object({
    roomId:     z.string().uuid().optional(),
    floorId:    z.string().uuid().optional(),
    buildingId: z.string().uuid().optional(),
  })
  .refine((q) => q.roomId || q.floorId || q.buildingId, {
    message: "one of roomId, floorId or buildingId is required",
    path: ["roomId"],
  });
export type AvailabilityQuery = z.infer<typeof availabilityQuery>;

export const allotmentsQuery = z.object({
  status:      z.string().max(24).optional(),
  targetType:  z.enum(["seat", "room"]).optional(),
  employeeRef: z.string().uuid().optional(),
  limit:       z.coerce.number().int().positive().max(200).default(50),
  offset:      z.coerce.number().int().nonnegative().default(0),
});

export const maintenanceQuery = z.object({
  status:    z.string().max(24).optional(),
  assetType: z.enum(["building", "floor", "room", "seat"]).optional(),
  limit:     z.coerce.number().int().positive().max(200).default(50),
  offset:    z.coerce.number().int().nonnegative().default(0),
});
