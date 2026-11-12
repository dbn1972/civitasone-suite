/**
 * visitor-service: resolve the printer device for a check-in badge.
 *
 * check-in used to publish printJobCreate with `deviceId: gateTerminalId ?? ""`; an empty or non-UUID
 * id dead-lettered every time (`invalid input syntax for type uuid: ""`). Resolution order:
 *   1. the supplied gateTerminalId, if it is a UUID of a live device of this tenant;
 *   2. the gate's default printer (an active `printer` device bound to the gate, online first);
 *   3. none -> the caller skips the print job (a badge can still be printed manually).
 */
import { and, desc, eq, ne } from "drizzle-orm";
import { devices } from "../device-registry/schema.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

const PRINT_WORDS = new Set(["print", "printer", "printers", "printing"]);
/** Whole-word match ("badge_printer", "badgePrinter", "print"); NOT "fingerprint" / "blueprint". */
function mentionsPrinting(text: string): boolean {
  return text.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).some((w) => PRINT_WORDS.has(w));
}

/** A printer device, or a terminal/kiosk with an attached printer (a capability key or value naming a printer). */
export function canPrint(d: { deviceType?: unknown; capabilities?: unknown } | undefined): boolean {
  if (!d) return false;
  if (d.deviceType === "printer") return true;
  const caps = d.capabilities;
  if (!caps || typeof caps !== "object") return false;
  return Object.entries(caps as Record<string, unknown>).some(([k, v]) =>
    mentionsPrinting(k) || (Array.isArray(v) && v.some((x) => typeof x === "string" && mentionsPrinting(x))));
}

export type BadgePrinterResolution =
  | { deviceId: string; source: "terminal" | "gate_default" }
  | { deviceId: null; reason: string };

// Structural tx type: only select() is needed (keeps this unit-testable without a real db).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SelectTx = { select: (...a: any[]) => any };

export async function resolveBadgePrinter(
  tx: SelectTx, tenantId: string, gateId: string, gateTerminalId?: string | null,
): Promise<BadgePrinterResolution> {
  if (gateTerminalId) {
    if (isUuid(gateTerminalId)) {
      const rows = await tx.select({ id: devices.id, deviceType: devices.deviceType, capabilities: devices.capabilities }).from(devices)
        .where(and(eq(devices.id, gateTerminalId), eq(devices.tenantId, tenantId), ne(devices.status, "deregistered")))
        .limit(1);
      // Only something that can print: a `printer` device, or a terminal advertising a print capability.
      if (isUuid(rows[0]?.id) && canPrint(rows[0])) return { deviceId: rows[0].id as string, source: "terminal" };
    }
    // falls through: unknown / non-UUID terminal id -> try the gate's default printer
  }
  const printers = await tx.select({ id: devices.id }).from(devices)
    .where(and(
      eq(devices.tenantId, tenantId), eq(devices.gateId, gateId),
      eq(devices.deviceType, "printer"), eq(devices.status, "active"),
    ))
    .orderBy(desc(devices.online), desc(devices.lastSeenAt))
    .limit(1);
  if (isUuid(printers[0]?.id)) return { deviceId: printers[0].id as string, source: "gate_default" };
  return {
    deviceId: null,
    reason: gateTerminalId
      ? `gateTerminalId '${gateTerminalId}' is not a printing device of this tenant and gate '${gateId}' has no active printer`
      : `no gateTerminalId given and gate '${gateId}' has no active printer`,
  };
}
