import { FUNNEL_STEPS, type ActivationEvent, type FunnelStep } from "@/lib/activation";

/**
 * In-memory activation event store (a ring buffer), mirroring the existing
 * loaderTelemetry pattern. This proves the funnel pipeline and powers the
 * internal activation view. For production durability this would be replaced by
 * the analytics-service facts table; the read/write surface here is kept small so
 * that swap is mechanical.
 */
const events: ActivationEvent[] = [];
const MAX_EVENTS = 5000;

export function recordActivationEvent(tenantId: string, step: FunnelStep, at = new Date().toISOString()): void {
  events.push({ tenantId, step, at });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

export function getActivationEvents(): ActivationEvent[] {
  return [...events];
}

export function isFunnelStep(value: unknown): value is FunnelStep {
  return typeof value === "string" && (FUNNEL_STEPS as readonly string[]).includes(value);
}
