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

export async function getServiceHealth(serviceName: string): Promise<ServiceHealth | null> {
  const match = DEFAULT_SERVICES.find((s) => s.name === serviceName || s.name.replace("-service", "") === serviceName);
  if (!match) return null;
  return probeService(match.name, match.port);
}
