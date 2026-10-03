import { cache } from "../../shared/infra.js";
import { aggregateHealth, DEFAULT_SERVICES, type ServiceHealth } from "./domain.js";

const HEALTH_CACHE_KEY = "admin:platform:health:aggregate";
const HEALTH_TTL = 30;

async function probeService(name: string, port: number): Promise<ServiceHealth> {
  const base = process.env.SERVICE_BASE_URL ?? "http://localhost";
  try {
    const res = await fetch(`${base}:${port}/health`, { signal: AbortSignal.timeout(3000) });
    const body = await res.json().catch(() => ({})) as { status?: string };
    return { service: name, status: res.ok ? (body.status ?? "ok") : "down", httpStatus: res.status };
  } catch {
    return { service: name, status: "down", httpStatus: 503 };
  }
}

export async function getAggregateHealth() {
  return cache.getOrLoad(HEALTH_CACHE_KEY, async () => {
    const services = DEFAULT_SERVICES;
    const results = await Promise.all(services.map((s) => probeService(s.name, s.port)));
    return aggregateHealth(results);
  }, HEALTH_TTL);
}

/**
 * GAP-ADMIN-DISCOVERY-02: the Service Discovery "Scan now" action. Drops the
 * cached aggregate and probes every registered service again. Throttled so a
 * button held down cannot turn the platform health endpoints into a probe
 * storm: within the window the cached snapshot is returned instead.
 */
const SCAN_MIN_INTERVAL_MS = Number(process.env.DISCOVERY_SCAN_MIN_INTERVAL_MS ?? 10_000);
let lastScanAt = 0;
export async function scanAggregateHealth(now: number = Date.now()): Promise<{ health: Awaited<ReturnType<typeof getAggregateHealth>>; throttled: boolean }> {
  if (now - lastScanAt < SCAN_MIN_INTERVAL_MS) return { health: await getAggregateHealth(), throttled: true };
  lastScanAt = now;
  await cache.invalidate(HEALTH_CACHE_KEY);
  return { health: await getAggregateHealth(), throttled: false };
}
/** Test seam: forget the last scan so the next one is not throttled. */
export function resetScanThrottleForTests(): void { lastScanAt = 0; }

export async function getServiceHealth(serviceName: string): Promise<ServiceHealth | null> {
  const match = DEFAULT_SERVICES.find((s) => s.name === serviceName || s.name.replace("-service", "") === serviceName);
  if (!match) return null;
  return probeService(match.name, match.port);
}
