/**
 * OCR provider availability for this tenant, read from admin-service's platform-integrations catalogue (category
 * `ocr`) over the internal service-to-service path, cached briefly. Any failure falls back to tesseract-only (always
 * available, on-device) so the settings screen never blocks on admin-service.
 */
import { pino } from "pino";
import { errMessage } from "./scrub.js";

const log = pino({ name: "bulk-scan-providers", level: process.env.LOG_LEVEL ?? "info" });

export interface ProviderInfo { id: string; label: string; available: boolean; sandbox: boolean }
export const TESSERACT_ONLY: ProviderInfo[] = [{ id: "tesseract", label: "Tesseract (on-device)", available: true, sandbox: false }];

const TTL_MS = (): number => Number(process.env.BULK_SCAN_PROVIDERS_CACHE_MS ?? 60_000);
const cache = new Map<string, { at: number; data: ProviderInfo[] }>();
export function resetProvidersCache(): void { cache.clear(); }

const adminUrl = (): string => process.env.ADMIN_SERVICE_URL ?? "http://127.0.0.1:3022";

export async function listOcrProviders(ctx: { tenantId: string; correlationId: string }): Promise<{ data: ProviderInfo[]; degraded: boolean }> {
  const hit = cache.get(ctx.tenantId);
  if (hit && Date.now() - hit.at < TTL_MS()) return { data: hit.data, degraded: false };
  const secret = process.env.INTERNAL_SERVICE_SECRET;
  if (!secret) return { data: TESSERACT_ONLY, degraded: true };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), Number(process.env.BULK_SCAN_PROVIDERS_TIMEOUT_MS ?? 3000));
  try {
    const res = await fetch(`${adminUrl()}/internal/v1/platform-integrations/ocr/availability`, {
      headers: { "x-internal": "1", "x-tenant-id": ctx.tenantId, "x-service-secret": secret, "x-internal-caller": "document-service", "x-correlation-id": ctx.correlationId },
      signal: ac.signal,
    });
    if (!res.ok) throw new Error("admin-service answered " + res.status);
    const body = (await res.json()) as { data?: unknown };
    const list = Array.isArray(body.data) ? body.data : [];
    const data: ProviderInfo[] = list.flatMap((r) => {
      const o = r as Record<string, unknown>;
      return typeof o.id === "string" && typeof o.label === "string" ? [{ id: o.id, label: o.label, available: o.available === true, sandbox: o.sandbox === true }] : [];
    });
    if (!data.some((p) => p.id === "tesseract")) data.unshift(...TESSERACT_ONLY);   // tesseract is always on
    cache.set(ctx.tenantId, { at: Date.now(), data });
    return { data, degraded: false };
  } catch (e) {
    log.warn({ err: errMessage(e) }, "bulk-scan: ocr provider catalogue unavailable; tesseract only");
    return { data: TESSERACT_ONLY, degraded: true };
  } finally {
    clearTimeout(timer);
  }
}
