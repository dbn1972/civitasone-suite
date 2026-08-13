/**
 * Trade License consumers — handle create / renew / cancel / payment commands.
 * _Requirements: SVC-TL-01_
 */
import type { Queue } from '@civitasone/queue';
import { eq, and } from 'drizzle-orm';
import { db } from '../../shared/db.js';
import { cache } from '../../shared/infra.js';
import { enqueue, markProcessed } from '../../shared/outbox.js';
import { SERVICE } from '../../topics.js';
import { tradeLicenses } from './schema.js';

const TL_CREATE  = 'revenue.trade_license.create';
const TL_RENEW   = 'revenue.trade_license.renew';
const TL_CANCEL  = 'revenue.trade_license.cancel';
const TL_PAYMENT = 'revenue.trade_license.payment';

export function registerTradeLicenseConsumers(queue: Queue): void {

  // ── tradeLicenseCreate ──────────────────────────────────────────────────────
  queue.subscribe(TL_CREATE, async (msg) => {
    const p = msg.payload as Record<string, unknown>;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const licenseNo = (p.licenseNo as string | undefined)
        ?? String(msg.messageId).replace(/-/g, '').slice(0, 12).toUpperCase();

      await tx.insert(tradeLicenses).values({
        tenantId:       msg.tenantId,
        licenseNo,
        businessName:   p.businessName as string,
        proprietorName: (p.proprietorName ?? p.ownerName ?? 'Unknown') as string,
        address:        p.address as string,
        wardNo:         ((p.wardNo ?? p.ward) as string | undefined) ?? null,
        businessType:   p.businessType as string,
        category:       (p.category as string | undefined) ?? 'A',
        issuedDate:     (p.issuedDate as string | undefined) ?? null,
        expiryDate:     (p.expiryDate as string | undefined) ?? null,
        feeMinor:       String(p.feeMinor ?? '0'),
        status:         'active',
        createdBy:      msg.actorId,
        updatedBy:      msg.actorId,
      });

      await enqueue(tx, {
        topic:         'revenue.trade_license.created',
        eventType:     'revenue.trade_license.created',
        tenantId:      msg.tenantId,
        actorId:       msg.actorId,
        correlationId: msg.correlationId,
        payload:       { licenseNo, businessName: p.businessName },
      });
      await enqueue(tx, {
        topic:         'audit.event.record',
        eventType:     'audit.event.record',
        tenantId:      msg.tenantId,
        actorId:       msg.actorId,
        correlationId: msg.correlationId,
        payload:       { service: SERVICE, action: 'create', resourceType: 'trade_license', outcome: 'success' },
      });
    });

    await cache.invalidate(`${SERVICE}:${msg.tenantId}:trade_licenses`);
  });

  // ── tradeLicenseRenew ───────────────────────────────────────────────────────
  queue.subscribe(TL_RENEW, async (msg) => {
    const p = msg.payload as Record<string, unknown>;
    const tradeLicenseId = p.tradeLicenseId as string;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const rows = await tx
        .select()
        .from(tradeLicenses)
        .where(and(eq(tradeLicenses.tenantId, msg.tenantId), eq(tradeLicenses.id, tradeLicenseId)))
        .limit(1);

      if (!rows[0]) return; // not found — idempotent no-op

      const expiryDate = (p.expiryDate as string | undefined)
        ?? (p.renewalYear ? `${p.renewalYear}-03-31` : undefined);

      await tx
        .update(tradeLicenses)
        .set({
          expiryDate:   expiryDate ?? null,
          feeMinor:     String(p.feeMinor ?? rows[0]!.feeMinor),
          feePaidMinor: '0',
          renewalCount: (rows[0]!.renewalCount ?? 0) + 1,
          status:       'active',
          updatedAt:    new Date(),
          updatedBy:    msg.actorId,
          version:      (rows[0]!.version ?? 1) + 1,
        })
        .where(and(eq(tradeLicenses.tenantId, msg.tenantId), eq(tradeLicenses.id, tradeLicenseId)));

      await enqueue(tx, {
        topic:         'revenue.trade_license.renewed',
        eventType:     'revenue.trade_license.renewed',
        tenantId:      msg.tenantId,
        actorId:       msg.actorId,
        correlationId: msg.correlationId,
        payload:       { tradeLicenseId },
      });
      await enqueue(tx, {
        topic:         'audit.event.record',
        eventType:     'audit.event.record',
        tenantId:      msg.tenantId,
        actorId:       msg.actorId,
        correlationId: msg.correlationId,
        payload:       { service: SERVICE, action: 'renew', resourceType: 'trade_license', outcome: 'success' },
      });
    });

    await cache.invalidate(`${SERVICE}:${msg.tenantId}:trade_licenses`);
    await cache.invalidate(`${SERVICE}:${msg.tenantId}:trade_license:${tradeLicenseId}`);
  });

  // ── tradeLicenseCancel ──────────────────────────────────────────────────────
  queue.subscribe(TL_CANCEL, async (msg) => {
    const p = msg.payload as Record<string, unknown>;
    const tradeLicenseId = p.tradeLicenseId as string;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      await tx
        .update(tradeLicenses)
        .set({ status: 'cancelled', isActive: false, updatedAt: new Date(), updatedBy: msg.actorId })
        .where(and(eq(tradeLicenses.tenantId, msg.tenantId), eq(tradeLicenses.id, tradeLicenseId)));

      await enqueue(tx, {
        topic:         'audit.event.record',
        eventType:     'audit.event.record',
        tenantId:      msg.tenantId,
        actorId:       msg.actorId,
        correlationId: msg.correlationId,
        payload:       { service: SERVICE, action: 'cancel', resourceType: 'trade_license', outcome: 'success' },
      });
    });

    await cache.invalidate(`${SERVICE}:${msg.tenantId}:trade_licenses`);
    await cache.invalidate(`${SERVICE}:${msg.tenantId}:trade_license:${tradeLicenseId}`);
  });

  // ── tradeLicensePayment ─────────────────────────────────────────────────────
  queue.subscribe(TL_PAYMENT, async (msg) => {
    const p = msg.payload as Record<string, unknown>;
    const tradeLicenseId = p.tradeLicenseId as string;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const rows = await tx
        .select()
        .from(tradeLicenses)
        .where(and(eq(tradeLicenses.tenantId, msg.tenantId), eq(tradeLicenses.id, tradeLicenseId)))
        .limit(1);

      if (!rows[0]) return;

      const paid = BigInt(p.amountMinor as string);
      const current = BigInt(rows[0]!.feePaidMinor ?? '0');
      const newPaid = current + paid;
      const fee = BigInt(rows[0]!.feeMinor ?? '0');
      const newStatus = newPaid >= fee ? 'active' : 'pending';

      await tx
        .update(tradeLicenses)
        .set({
          feePaidMinor: String(newPaid),
          status:       newStatus,
          updatedAt:    new Date(),
          updatedBy:    msg.actorId,
        })
        .where(and(eq(tradeLicenses.tenantId, msg.tenantId), eq(tradeLicenses.id, tradeLicenseId)));

      await enqueue(tx, {
        topic:         'revenue.trade_license.payment_recorded',
        eventType:     'revenue.trade_license.payment_recorded',
        tenantId:      msg.tenantId,
        actorId:       msg.actorId,
        correlationId: msg.correlationId,
        payload:       { tradeLicenseId, amountMinor: String(paid) },
      });
      await enqueue(tx, {
        topic:         'audit.event.record',
        eventType:     'audit.event.record',
        tenantId:      msg.tenantId,
        actorId:       msg.actorId,
        correlationId: msg.correlationId,
        payload:       { service: SERVICE, action: 'payment', resourceType: 'trade_license', outcome: 'success' },
      });
    });

    await cache.invalidate(`${SERVICE}:${msg.tenantId}:trade_licenses`);
    await cache.invalidate(`${SERVICE}:${msg.tenantId}:trade_license:${tradeLicenseId}`);
  });
}
