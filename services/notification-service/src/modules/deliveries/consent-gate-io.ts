/**
 * R1 — loads the consent signals that `decideGate()` needs.
 *
 * Kept separate from `consent-gate.ts` so the decision itself stays pure and
 * unit-testable. Every read runs inside the CALLER'S transaction: the gate must
 * see the same snapshot as the delivery write, otherwise a suppression added
 * mid-send could be missed.
 *
 * Used by both outbound paths — the per-recipient send consumer and the bulk
 * campaign fan-out — so the two cannot drift apart.
 */
import { and, eq } from "drizzle-orm";
import type { db } from "../../shared/db.js";
import { notificationPrefs } from "../templates/schema.js";
import type { PrefView } from "../templates/domain.js";
import { isSuppressed } from "../bounces/repo.js";
import * as dndRepo from "../dnd/repo.js";
import { isDndActive, type DndDecision, type DndWindow } from "../dnd/domain.js";

type Reader = Pick<typeof db, "insert" | "update" | "select">;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `templates.prefs.user_id` and `dnd.dnd_windows.user_id` are uuid columns. A
 * legacy payload whose only identifier is an email address cannot match a row
 * there, and comparing it would abort the transaction with a 22P02 rather than
 * evaluate consent — so it resolves to "no rows" instead.
 */
export function asUserUuid(value: string | null | undefined): string | null {
  return value && UUID_RE.test(value) ? value : null;
}

export type ConsentSignals = {
  suppressed: boolean;
  dnd: DndDecision;
  prefs: PrefView[];
};

export async function loadConsentSignals(
  tx: Reader,
  tenantId: string,
  recipient: string,
  userId: string | null,
  now: Date = new Date(),
): Promise<ConsentSignals> {
  const suppressed = await isSuppressed(tx, tenantId, recipient);

  const prefRows = userId
    ? await tx.select().from(notificationPrefs).where(and(
        eq(notificationPrefs.tenantId, tenantId),
        eq(notificationPrefs.userId, userId),
      ))
    : [];
  const prefs: PrefView[] = prefRows.map((r) => ({
    id: r.id, tenantId: r.tenantId, userId: r.userId, eventType: r.eventType,
    inApp: r.inApp, email: r.email, push: r.push, sms: r.sms, whatsapp: r.whatsapp,
    version: r.version,
  }));

  const windowRows = userId
    ? await dndRepo.findActiveWindowsTx(tx, tenantId, userId)
    : [];
  const dnd = isDndActive(windowRows.map(toDndWindow), now);

  return { suppressed, dnd, prefs };
}

/** A `dnd.dnd_windows` row in the shape the pure evaluator expects. */
function toDndWindow(row: {
  startTime: string; endTime: string; timezone: string; days: unknown; enabled: boolean;
}): DndWindow {
  return {
    startTime: row.startTime,
    endTime: row.endTime,
    timezone: row.timezone,
    days: Array.isArray(row.days) ? (row.days as string[]) : [],
    enabled: row.enabled,
  };
}
